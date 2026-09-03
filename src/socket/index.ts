import { Server, Socket } from "socket.io";
import http from "http";
import config from "../config";
import { logger } from "../logger/logger";
import verifyJwtToken from "../jwt/verifyJwtToken";
import { UserRepository } from "../module/user/user.repository";
import { CallService } from "../module/call/call.service";
import Call from "../module/call/call.model";

import { ShowRepository } from "../module/show/show.repository";

let io: Server | null = null;

// Track last active show per station to detect transitions
const lastActiveShow: Map<string, string | null> = new Map();

// Mutex for show transition checks (prevents duplicate events)
const showTransitionLocks: Map<string, boolean> = new Map();

// Track socket connections per user (limit to 5 per user)
const userConnectionCount: Map<string, number> = new Map();
const MAX_CONNECTIONS_PER_USER = 5;

export function initSocket(server: http.Server): Server {
  io = new Server(server, {
    transports: ["websocket", "polling"],
    allowUpgrades: true,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const payload = verifyJwtToken(token, config.jwt.jwt_secret as string);
      const user = await UserRepository.findById(payload.userId);
      if (!user || user.isDeleted || user.isBlocked) {
        return next(new Error("Invalid or blocked account"));
      }

      (socket as any).userId = user._id.toString();
      (socket as any).userRole = user.role;
      (socket as any).stationId = user.stationId?.toString() || null;
      (socket as any).showIds = [];

      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId;
    const userRole = (socket as any).userRole;
    logger.info(`Socket connected: ${socket.id} (user: ${userId})`);

    // Connection limit per user — close oldest if exceeded
    const currentCount = userConnectionCount.get(userId) || 0;
    if (currentCount >= MAX_CONNECTIONS_PER_USER) {
      logger.warn(`Socket ${socket.id} exceeded connection limit for user ${userId} (${currentCount}/${MAX_CONNECTIONS_PER_USER})`);
      // Find and close the oldest connection for this user
      const ioServer = io!;
      for (const [sid, s] of ioServer.sockets.sockets) {
        if ((s as any).userId === userId && sid !== socket.id) {
          s.disconnect(true);
          userConnectionCount.set(userId, currentCount - 1);
          break;
        }
      }
    }
    userConnectionCount.set(userId, (userConnectionCount.get(userId) || 0) + 1);

    // Auto-join user's personal room for direct messaging
    socket.join(`user:${userId}`);

    // Track operator online status (media_station, station_admin, super_admin)
    if (["media_station", "station_admin", "super_admin"].includes(userRole)) {
      CallService.setOperatorOnline(userId).catch((err) =>
        logger.error(`[Call] Failed to set operator online: ${err.message}`),
      );
    }
    // Fix 7: Authorization — users can only join their own station room
    socket.on("join-station", (stationId: string) => {
      const userRole = (socket as any).userRole;
      const userStationId = (socket as any).stationId as string | null;

      // super_admin can join any station; others only their own
      if (userRole !== "super_admin" && userStationId !== stationId) {
        logger.warn(`Socket ${socket.id} denied join to station:${stationId} (not their station)`);
        socket.emit("error", { message: "You can only join your own station room" });
        return;
      }

      socket.join(`station:${stationId}`);
      logger.info(`Socket ${socket.id} joined station:${stationId}`);

      // Refresh operator online status when joining station room
      if (["media_station", "presenter", "station_admin", "super_admin"].includes(userRole)) {
        CallService.refreshOperatorOnline(userId).catch(() => {});
      }
    });

    socket.on("leave-station", (stationId: string) => {
      socket.leave(`station:${stationId}`);
      logger.info(`Socket ${socket.id} left station:${stationId}`);
    });

    socket.on("join-show", async (showId: string) => {
      const userRole = (socket as any).userRole;
      const userStationId = (socket as any).stationId as string | null;

      // super_admin can join any show
      if (userRole === "super_admin") {
        socket.join(`show:${showId}`);
        logger.info(`Socket ${socket.id} joined show:${showId}`);
        return;
      }

      // Listeners can join any show (they see show status)
      if (userRole === "user") {
        socket.join(`show:${showId}`);
        logger.info(`Socket ${socket.id} joined show:${showId}`);
        return;
      }

      // Staff roles: verify the show belongs to their station
      try {
        const show = await ShowRepository.findById(showId);
        if (!show || show.station?.toString() !== userStationId) {
          socket.emit("error", { message: "You can only join shows from your own station" });
          return;
        }
        socket.join(`show:${showId}`);
        logger.info(`Socket ${socket.id} joined show:${showId}`);
      } catch (err) {
        logger.error(`[Socket] join-show verification error: ${err}`);
        socket.emit("error", { message: "Failed to verify show access" });
      }
    });

    socket.on("leave-show", (showId: string) => {
      socket.leave(`show:${showId}`);
      logger.info(`Socket ${socket.id} left show:${showId}`);
    });

    // Support ticket real-time socket events
    socket.on("join-support-queue", (scope?: { countryId?: string }) => {
      if (["customer_care", "super_admin", "partner_admin"].includes(userRole)) {
        if (scope?.countryId) {
          socket.join(`support_queue:${scope.countryId}`);
        }
        socket.join("support_queue:global");
        logger.info(`Socket ${socket.id} joined support queue`);
      }
    });

    socket.on("join-support-conversation", (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      logger.info(`Socket ${socket.id} joined conversation:${conversationId}`);
    });

    socket.on("leave-support-conversation", (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
      logger.info(`Socket ${socket.id} left conversation:${conversationId}`);
    });

    // Refresh operator online status on heartbeat/ping (rate-limited: max 1 per 20s)
    let lastPingAt = 0;
    socket.on("ping", () => {
      const now = Date.now();
      if (now - lastPingAt < 20000) return; // Rate limit: 1 ping per 20s
      lastPingAt = now;
      if (["media_station", "presenter", "station_admin", "super_admin"].includes(userRole)) {
        CallService.refreshOperatorOnline(userId).catch(() => {});
      }
    });

    socket.on("disconnect", async () => {
      const disconnectUserId = (socket as any).userId;
      const disconnectUserRole = (socket as any).userRole;
      logger.info(`Socket disconnected: ${socket.id}`);

      // Decrement connection count
      const count = userConnectionCount.get(disconnectUserId) || 0;
      if (count <= 1) {
        userConnectionCount.delete(disconnectUserId);
      } else {
        userConnectionCount.set(disconnectUserId, count - 1);
      }

      // Clean up operator status (if operator)
      try {
        if (["media_station", "presenter", "station_admin", "super_admin"].includes(disconnectUserRole)) {
          const activeCallId = await CallService.getOperatorOnCallId(disconnectUserId);
          if (activeCallId) {
            await CallService.removeOperatorOnCall(disconnectUserId);

            // Clear any pending timeouts for this call
            CallService.clearJoinTimeout(activeCallId);
            CallService.clearQueueTimeout(activeCallId);

            // Read ORIGINAL status before updating (for refund + duration calculation)
            const originalCall = await Call.findById(activeCallId)
              .select("startedBy station creditsUsed status answeredAt")
              .lean();

            if (originalCall) {
              // Calculate duration and status for answered calls
              const newStatus = originalCall.status === "answered" ? "completed" : "missed";
              const duration = (originalCall.status === "answered" && originalCall.answeredAt)
                ? Math.floor((Date.now() - originalCall.answeredAt.getTime()) / 1000)
                : 0;

              // Atomic update — only if call hasn't been ended by another operation
              const updated = await Call.findOneAndUpdate(
                {
                  _id: activeCallId,
                  status: { $nin: ["missed", "rejected", "cancelled", "completed"] },
                },
                { $set: { status: newStatus, endedAt: new Date(), duration } },
                { new: true },
              );

              if (updated) {
                // Refund if call was queued (use updated.answeredAt to avoid stale read race)
                if (updated.status === "missed" && !updated.answeredAt && originalCall.creditsUsed > 0) {
                  await CallService.refundIfQueued(
                    activeCallId,
                    originalCall.startedBy.toString(),
                    originalCall.creditsUsed,
                    originalCall.station.toString(),
                  );
                }

                // Create listener statement for answered calls (non-critical)
                if (updated.status === "completed") {
                  await CallService.createStatementIfNeeded(activeCallId);
                }

                // Notify all parties
                CallService.emitCallEnded(
                  activeCallId,
                  originalCall.station.toString(),
                  originalCall.startedBy.toString(),
                  undefined,
                  "operator_disconnected",
                  "Operator disconnected.",
                );
              } else {
                logger.info(`[Call] Disconnect: call ${activeCallId} already ended by another operation`);
              }
            }

            logger.warn(`[Call] Operator ${disconnectUserId} disconnected during active call`);
          }
        }

        // Handle user disconnect — end active call where user is the caller
        if (disconnectUserRole === "user") {
          const activeCall = await Call.findOne({
            startedBy: disconnectUserId,
            status: { $in: ["queued", "answered"] },
          }).select("_id station handledBy creditsUsed status answeredAt").lean();

          if (activeCall) {
            // Calculate duration if answered
            const newStatus = activeCall.status === "answered" ? "completed" : "missed";
            const duration = (activeCall.status === "answered" && activeCall.answeredAt)
              ? Math.floor((Date.now() - activeCall.answeredAt.getTime()) / 1000)
              : 0;

            // Atomic update — only if call hasn't been ended by another operation
            const updated = await Call.findOneAndUpdate(
              {
                _id: activeCall._id,
                status: { $nin: ["missed", "rejected", "cancelled", "completed"] },
              },
              { $set: { status: newStatus, endedAt: new Date(), duration } },
              { new: true },
            );

            if (updated) {
              // Refund if call was queued (use updated.answeredAt to avoid stale read race)
              if (updated.status === "missed" && !updated.answeredAt && activeCall.creditsUsed > 0) {
                await CallService.refundIfQueued(
                  activeCall._id.toString(),
                  disconnectUserId,
                  activeCall.creditsUsed,
                  activeCall.station.toString(),
                );
              }

              // Clean up operator on-call FIRST (critical — must run even if statement fails)
              if (activeCall.handledBy) {
                await CallService.removeOperatorOnCall(activeCall.handledBy.toString());
              }

              // Create listener statement for completed calls (non-critical)
              if (updated.status === "completed") {
                await CallService.createStatementIfNeeded(activeCall._id.toString());
              }

              // Notify operator if on call
              if (activeCall.handledBy) {
                CallService.emitCallEnded(
                  activeCall._id.toString(),
                  activeCall.station.toString(),
                  disconnectUserId,
                  activeCall.handledBy.toString(),
                  "user_disconnected",
                  "User disconnected.",
                );
              }

              // Notify station room
              CallService.emitCallEnded(
                activeCall._id.toString(),
                activeCall.station.toString(),
                disconnectUserId,
                activeCall.handledBy?.toString(),
                "user_disconnected",
                "User disconnected.",
              );
            }

            logger.warn(`[Call] User ${disconnectUserId} disconnected during active call`);
          }
        }

        // Only remove operator online status for operator roles
        if (["media_station", "presenter", "station_admin", "super_admin"].includes(disconnectUserRole)) {
          await CallService.removeOperatorOnline(disconnectUserId);
        }
      } catch (err) {
        logger.error(`[Call] Disconnect cleanup error for user ${disconnectUserId}:`, err);
      }
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) {
    throw new Error("Socket.io not initialized. Call initSocket first.");
  }
  return io;
}

export function emitToStation(stationId: string, event: string, data: unknown): void {
  const room = `station:${stationId}`;
  const io = getIO();
  const sockets = io.sockets.adapter.rooms.get(room);
  const count = sockets?.size ?? 0;
  logger.info(`[Socket] emitToStation: room=${room}, clients=${count}, event=${event}`);
  io.to(room).emit(event, data);
}

export function emitToShow(showId: string, event: string, data: unknown): void {
  const room = `show:${showId}`;
  const io = getIO();
  const sockets = io.sockets.adapter.rooms.get(room);
  const count = sockets?.size ?? 0;
  logger.info(`[Socket] emitToShow: room=${room}, clients=${count}, event=${event}`);
  io.to(room).emit(event, data);
}

/**
 * Emit an event to a specific user's room.
 * Used to deliver station replies directly to listeners.
 */
export function emitToUser(userId: string, event: string, data: unknown): void {
  const room = `user:${userId}`;
  const io = getIO();
  const sockets = io.sockets.adapter.rooms.get(room);
  const count = sockets?.size ?? 0;
  logger.info(`[Socket] emitToUser: room=${room}, clients=${count}, event=${event}`);
  io.to(room).emit(event, data);
}

/**
 * Check if the active show for a station has changed and emit transition events.
 * Called on each message send to detect show start/end.
 */
export function checkAndEmitShowTransition(
  stationId: string,
  currentShowId: string | null,
  showName: string | null,
): void {
  // Mutex: skip if already processing this station
  if (showTransitionLocks.get(stationId)) return;
  showTransitionLocks.set(stationId, true);

  try {
    const prevShowId = lastActiveShow.get(stationId) ?? null;

    if (currentShowId !== prevShowId) {
      // Show ended (previous show no longer active)
      if (prevShowId) {
        emitToStation(stationId, "show-ended", {
          stationId,
          showId: prevShowId,
        });
        logger.info(`[Socket] show-ended emitted for station:${stationId}, show:${prevShowId}`);
      }

      // Show started (new show is now active)
      if (currentShowId) {
        emitToStation(stationId, "show-started", {
          stationId,
          showId: currentShowId,
          showName,
        });
        logger.info(`[Socket] show-started emitted for station:${stationId}, show:${currentShowId}`);
      }

      lastActiveShow.set(stationId, currentShowId);
    }
  } finally {
    showTransitionLocks.delete(stationId);
  }
}
