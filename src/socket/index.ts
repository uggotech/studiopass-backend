import { Server, Socket } from "socket.io";
import http from "http";
import config from "../config";
import { logger } from "../logger/logger";
import verifyJwtToken from "../jwt/verifyJwtToken";
import { UserRepository } from "../module/user/user.repository";
import { CallService } from "../module/call/call.service";
import Call from "../module/call/call.model";

import { ShowRepository } from "../module/show/show.repository";
import { SupportConversation } from "../module/support/support.model";

let io: Server | null = null;

// Track last active show per station to detect transitions
const lastActiveShow: Map<string, string | null> = new Map();

// Mutex for show transition checks (prevents duplicate events)
const showTransitionLocks: Map<string, boolean> = new Map();

// Track socket connections per user (limit to 5 per user)
const userConnectionCount: Map<string, number> = new Map();
const MAX_CONNECTIONS_PER_USER = 5;

// Grace period timers for socket disconnects — prevents mobile blips from ending active calls
const disconnectGraceTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * True while the user still has at least one live socket (another tab / device).
 * At "disconnect" time the closing socket has already left its rooms, so this
 * only counts the remaining connections.
 */
function userHasLiveSocket(userId: string): boolean {
  if (!io) return false;
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return !!room && room.size > 0;
}

/** Store a grace timer for a user, clearing any earlier one so no orphan timer survives. */
function setDisconnectGraceTimer(userId: string, timer: NodeJS.Timeout): void {
  const previous = disconnectGraceTimers.get(userId);
  if (previous) clearTimeout(previous);
  disconnectGraceTimers.set(userId, timer);
}

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

      // Reject sockets for revoked/expired sessions
      if (payload.sid) {
        try {
          const { default: redisClient } = await import("../redis/redisClient");
          const isActiveSession = await redisClient.get(`session:active:${payload.sid}`);
          if (!isActiveSession) {
            return next(new Error("Session revoked or expired"));
          }
        } catch {
          // Redis unavailable — allow connection (fail open for live ops)
        }
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

    // Cancel pending disconnect grace timer — user reconnected in time
    const pendingGrace = disconnectGraceTimers.get(userId);
    if (pendingGrace) {
      clearTimeout(pendingGrace);
      disconnectGraceTimers.delete(userId);
      logger.info(`[Call] Cancelled disconnect grace for ${userId} — socket reconnected`);
    }

    // Connection limit per user — close oldest if exceeded
    const currentCount = userConnectionCount.get(userId) || 0;
    if (currentCount >= MAX_CONNECTIONS_PER_USER) {
      logger.warn(`Socket ${socket.id} exceeded connection limit for user ${userId} (${currentCount}/${MAX_CONNECTIONS_PER_USER})`);
      // Find and close the oldest connection for this user
      const ioServer = io!;
      for (const [sid, s] of ioServer.sockets.sockets) {
        if ((s as any).userId === userId && sid !== socket.id) {
          // The evicted socket's own "disconnect" handler decrements the counter
          s.disconnect(true);
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
    // Authorization: staff can only join their own station room; listeners can join station room for public show/poll events
    socket.on("join-station", (stationId: string) => {
      const userRole = (socket as any).userRole;
      const userStationId = (socket as any).stationId as string | null;

      // Staff roles: verify ownership and join private staff room (super_admin has global access)
      const isStaffRole = ["media_station", "presenter", "station_admin"].includes(userRole);
      if (userRole === "super_admin" || (isStaffRole && userStationId === stationId)) {
        socket.join(`station-staff:${stationId}`);
        logger.info(`Staff socket ${socket.id} (role: ${userRole}) joined station-staff:${stationId}`);

        // Only the station's Media Station accounts receive call events (incoming / removed / ended)
        if (userRole === "media_station") {
          socket.join(`station-calls:${stationId}`);
          logger.info(`Media station socket ${socket.id} joined station-calls:${stationId}`);
        }
      } else if (isStaffRole && userStationId !== stationId) {
        logger.warn(`Socket ${socket.id} denied staff join to station:${stationId} (not their station)`);
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
      socket.leave(`station-staff:${stationId}`);
      socket.leave(`station-calls:${stationId}`);
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

      // Listeners must not join show rooms: those rooms carry staff-side message events.
      // Show start/end reaches listeners through the public station room instead.
      if (userRole === "user") {
        socket.emit("error", { message: "Listeners cannot join show rooms" });
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

    socket.on("join-support-conversation", async (conversationId: string) => {
      try {
        if (!conversationId || !userId) {
          socket.emit("error", { message: "Invalid support conversation" });
          return;
        }

        const conversation = await SupportConversation.findById(conversationId)
          .select("userId assignedAgentId status")
          .lean();
        if (!conversation) {
          socket.emit("error", { message: "Support conversation not found" });
          return;
        }

        const isOwner = conversation.userId?.toString() === userId;
        const isAgent = ["customer_care", "super_admin", "partner_admin"].includes(userRole);
        const isAssigned = conversation.assignedAgentId?.toString() === userId;
        const canJoinAsAgent =
          userRole === "super_admin" ||
          conversation.status === "OPEN" ||
          isAssigned;

        if (!isOwner && !(isAgent && canJoinAsAgent)) {
          socket.emit("error", { message: "Not authorized to join this support conversation" });
          return;
        }

        socket.join(`conversation:${conversationId}`);
        logger.info(`Socket ${socket.id} joined conversation:${conversationId}`);
      } catch (err) {
        logger.error(`[Socket] join-support-conversation error: ${err}`);
        socket.emit("error", { message: "Failed to join support conversation" });
      }
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

      // Another tab / device of the same user is still connected:
      // the call (and the operator's online status) must not be touched.
      if (userHasLiveSocket(disconnectUserId)) {
        logger.info(`[Call] User ${disconnectUserId} still has another live socket — no call grace started`);
        return;
      }

      const graceMs = config.calls.socket_disconnect_grace_ms;
      const isOperatorRole = ["media_station", "presenter", "station_admin", "super_admin"].includes(disconnectUserRole);

      try {
        // ─── Operator disconnect — grace period before ending call ────────
        if (isOperatorRole) {
          const activeCallId = await CallService.getOperatorOnCallId(disconnectUserId);
          if (activeCallId) {
            // Join / queue timeouts keep running on purpose: if the listener never joins,
            // the call must still be ended even when the operator reconnects.
            logger.info(`[Call] Operator ${disconnectUserId} disconnected — starting ${graceMs}ms grace for call ${activeCallId}`);

            const graceTimer = setTimeout(async () => {
              disconnectGraceTimers.delete(disconnectUserId);
              try {
                // Reconnected during the grace period (the connection handler also clears this timer)
                if (userHasLiveSocket(disconnectUserId)) return;

                const ended = await CallService.endCallBySystem(
                  activeCallId,
                  "operator_disconnected",
                  "Operator disconnected.",
                  { handledBy: disconnectUserId },
                );
                if (!ended) {
                  // Call was already over — just make sure the marker is gone
                  await CallService.removeOperatorOnCall(disconnectUserId, activeCallId);
                  logger.info(`[Call] Grace expired for operator ${disconnectUserId} but call ${activeCallId} already ended`);
                } else {
                  logger.warn(`[Call] Operator ${disconnectUserId} grace expired — call ${activeCallId} ended`);
                }
              } catch (err) {
                logger.error(`[Call] Operator grace expiry error for call ${activeCallId}:`, err);
              }
            }, graceMs);

            setDisconnectGraceTimer(disconnectUserId, graceTimer);
          }
        }

        // ─── User (listener) disconnect — grace period before ending call ──
        if (disconnectUserRole === "user") {
          const activeCall = await Call.findOne({
            startedBy: disconnectUserId,
            status: { $in: ["queued", "answered"] },
          })
            .select("_id")
            .lean();

          if (activeCall) {
            const activeCallId = activeCall._id.toString();
            logger.info(`[Call] User ${disconnectUserId} disconnected — starting ${graceMs}ms grace for call ${activeCallId}`);

            const graceTimer = setTimeout(async () => {
              disconnectGraceTimers.delete(disconnectUserId);
              try {
                // Reconnected during the grace period
                if (userHasLiveSocket(disconnectUserId)) return;

                const ended = await CallService.endCallBySystem(
                  activeCallId,
                  "user_disconnected",
                  "User disconnected.",
                );
                if (ended) {
                  logger.warn(`[Call] User ${disconnectUserId} grace expired — call ${activeCallId} ended`);
                }
              } catch (err) {
                logger.error(`[Call] User grace expiry error for call ${activeCallId}:`, err);
              }
            }, graceMs);

            setDisconnectGraceTimer(disconnectUserId, graceTimer);
          }
        }

        // Only remove operator online status for operator roles
        if (isOperatorRole) {
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

/**
 * Emit to the station's Media Station accounts only (incoming calls, queue changes, call endings).
 * Presenters, station admins and listeners are not in this room.
 */
export function emitToStationCalls(stationId: string, event: string, data: unknown): void {
  const room = `station-calls:${stationId}`;
  const io = getIO();
  const sockets = io.sockets.adapter.rooms.get(room);
  const count = sockets?.size ?? 0;
  logger.info(`[Socket] emitToStationCalls: room=${room}, clients=${count}, event=${event}`);
  io.to(room).emit(event, data);
}

export function emitToStationStaff(stationId: string, event: string, data: unknown): void {
  const room = `station-staff:${stationId}`;
  const io = getIO();
  const sockets = io.sockets.adapter.rooms.get(room);
  const count = sockets?.size ?? 0;
  logger.info(`[Socket] emitToStationStaff: room=${room}, clients=${count}, event=${event}`);
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

const LAST_SHOW_KEY = (stationId: string) => `show:last:${stationId}`;
const LAST_SHOW_NONE = "none";
const LAST_SHOW_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * Last known active show of a station: memory first, Redis second (survives a restart).
 * Returns undefined when this station has never been observed.
 */
async function loadLastActiveShow(stationId: string): Promise<string | null | undefined> {
  if (lastActiveShow.has(stationId)) return lastActiveShow.get(stationId) ?? null;
  try {
    const { default: redisClient } = await import("../redis/redisClient");
    const stored = await redisClient.get(LAST_SHOW_KEY(stationId));
    if (stored === null) return undefined;
    const value = stored === LAST_SHOW_NONE ? null : stored;
    lastActiveShow.set(stationId, value);
    return value;
  } catch {
    return undefined;
  }
}

async function saveLastActiveShow(stationId: string, showId: string | null): Promise<void> {
  lastActiveShow.set(stationId, showId);
  try {
    const { default: redisClient } = await import("../redis/redisClient");
    await redisClient.set(LAST_SHOW_KEY(stationId), showId ?? LAST_SHOW_NONE, LAST_SHOW_TTL_SEC);
  } catch {
    // Redis unavailable — memory state still works for this process
  }
}

/**
 * Check if the active show for a station has changed and emit transition events.
 * Called by the show scheduler (every few seconds) and on each message send.
 *
 * - The first observation of a station only records the state (no event, no refetch storm
 *   after a restart); the state is kept in Redis so a restart does not lose it.
 * - The cached "active show" for the station is cleared BEFORE the events go out, so the
 *   refetch triggered by show-started / show-ended already sees the new show.
 */
export async function checkAndEmitShowTransition(
  stationId: string,
  currentShowId: string | null,
  showName: string | null,
): Promise<void> {
  // Skip if this station is already being processed (scheduler tick vs message flow)
  if (showTransitionLocks.get(stationId)) return;
  showTransitionLocks.set(stationId, true);

  try {
    const prevShowId = await loadLastActiveShow(stationId);

    if (prevShowId === undefined) {
      await saveLastActiveShow(stationId, currentShowId);
      return;
    }

    if (currentShowId !== prevShowId) {
      // Drop the cached active show so the next fetch returns the new state
      try {
        const { default: redisClient } = await import("../redis/redisClient");
        await redisClient.delete(`show:active:${stationId}`);
      } catch {
        // cache is best-effort
      }

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

      await saveLastActiveShow(stationId, currentShowId);
    }
  } finally {
    showTransitionLocks.delete(stationId);
  }
}
