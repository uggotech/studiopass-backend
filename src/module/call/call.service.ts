import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import AppError from "../../errors/AppError";
import Call from "./call.model";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "../show/show.repository";
import { CreditService } from "../credit/credit.service";
import { CreditRepository } from "../credit/credit.repository";
import { Country } from "../country/country.model";
import { User } from "../user/user.model";
import redisClient from "../../redis/redisClient";
import config from "../../config";
import { logger } from "../../logger/logger";
import {
  emitToStation,
  emitToUser,
  getIO,
} from "../../socket";

// ─── Timeout Maps ────────────────────────────────────────────────────────────
const callQueueTimeouts = new Map<string, NodeJS.Timeout>();
const callJoinTimeouts = new Map<string, NodeJS.Timeout>();

// ─── Operator Status Helpers ─────────────────────────────────────────────────

const setOperatorOnline = async (userId: string): Promise<void> => {
  await redisClient.set(`operator:${userId}:online`, "1", 60);
};

const refreshOperatorOnline = async (userId: string): Promise<void> => {
  if (await redisClient.get(`operator:${userId}:online`)) {
    await redisClient.set(`operator:${userId}:online`, "1", 60);
  }
};

const removeOperatorOnline = async (userId: string): Promise<void> => {
  await redisClient.delete(`operator:${userId}:online`);
};

const setOperatorOnCall = async (userId: string, callId: string): Promise<void> => {
  // TTL of 2 hours as safety net — prevents stale keys after server crash
  await redisClient.set(`operator:${userId}:on_call`, callId, 7200);
};

const removeOperatorOnCall = async (userId: string): Promise<void> => {
  await redisClient.delete(`operator:${userId}:on_call`);
};

const isOperatorOnCall = async (userId: string): Promise<boolean> => {
  const callId = await redisClient.get(`operator:${userId}:on_call`);
  return !!callId;
};

/**
 * Check how many operators are available for a station.
 * Available = connected to station socket room AND not on a call.
 */
const getAvailableOperatorCount = async (stationId: string): Promise<number> => {
  const io = getIO();
  const room = `station:${stationId}`;
  const sockets = io.sockets.adapter.rooms.get(room);
  if (!sockets || sockets.size === 0) return 0;

  // Collect all user IDs first, then check Redis in parallel
  const userIds: string[] = [];
  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const userId = (socket as any).userId;
    if (!userId) continue;
    userIds.push(userId);
  }

  if (userIds.length === 0) return 0;

  // Parallel Redis checks
  const onCallResults = await Promise.all(
    userIds.map((uid) => isOperatorOnCall(uid)),
  );

  return onCallResults.filter((onCall) => !onCall).length;
};

// ─── Token Generation ────────────────────────────────────────────────────────

const generateAgoraToken = (channelName: string, uid: number): string => {
  const appId = config.agora.app_id;
  const appCertificate = config.agora.app_certificate;

  if (!appId || !appCertificate) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Agora credentials not configured",
    );
  }

  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    3600, // token expires in 1 hour (relative duration, not absolute timestamp)
    0,    // privilege expires immediately (no extended privilege)
  );
};

// ─── Queue Timeout ───────────────────────────────────────────────────────────

const startQueueTimeout = (callId: string, userId: string, stationId: string): void => {
  const timeoutMs = config.calls.queue_timeout_ms;

  const timeoutId = setTimeout(async () => {
    try {
      const result = await Call.findOneAndUpdate(
        { _id: callId, status: "queued" },
        { $set: { status: "missed", endedAt: new Date() } },
        { new: true },
      );

      if (result) {
        // Notify caller
        emitToUser(userId, "call-ended", {
          callId,
          reason: "timeout",
          message: "No operator available. Please try again later.",
        });
        // Notify station — remove ghost incoming-call
        emitToStation(stationId, "call-cancelled", { callId });
        logger.info(`[Call] Queue timeout: call ${callId} auto-missed after ${timeoutMs}ms`);
      }
    } catch (err) {
      logger.error(`[Call] Queue timeout error for call ${callId}:`, err);
    } finally {
      callQueueTimeouts.delete(callId);
    }
  }, timeoutMs);

  callQueueTimeouts.set(callId, timeoutId);
};

const clearQueueTimeout = (callId: string): void => {
  const timeoutId = callQueueTimeouts.get(callId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    callQueueTimeouts.delete(callId);
  }
};

// ─── Join Confirmation Timeout ───────────────────────────────────────────────

const startJoinTimeout = (
  callId: string,
  userId: string,
  stationId: string,
  operatorId: string,
): void => {
  const timeoutMs = config.calls.join_confirmation_timeout_ms;

  const timeoutId = setTimeout(async () => {
    try {
      const result = await Call.findOneAndUpdate(
        { _id: callId, status: "answered" },
        { $set: { status: "missed", endedAt: new Date() } },
        { new: true },
      );

      if (result) {
        await removeOperatorOnCall(operatorId);

        emitToUser(userId, "call-ended", {
          callId,
          reason: "join_timeout",
          message: "Call ended — connection not established.",
        });
        emitToStation(stationId, "call-ended", {
          callId,
          reason: "join_timeout",
        });
        logger.info(`[Call] Join timeout: call ${callId} auto-ended after ${timeoutMs}ms`);
      }
    } catch (err) {
      logger.error(`[Call] Join timeout error for call ${callId}:`, err);
    } finally {
      callJoinTimeouts.delete(callId);
    }
  }, timeoutMs);

  callJoinTimeouts.set(callId, timeoutId);
};

const clearJoinTimeout = (callId: string): void => {
  const timeoutId = callJoinTimeouts.get(callId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    callJoinTimeouts.delete(callId);
  }
};

// ─── Request Call (User initiates) ───────────────────────────────────────────

const requestCall = async (userId: string, stationId: string) => {
  // 1. Validate station
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }
  if (!station.isActive) {
    throw new AppError(StatusCodes.BAD_REQUEST, "This station is currently inactive.");
  }

  // 2. One active call per user check
  const existingActive = await Call.findOne({
    startedBy: userId,
    status: { $in: ["queued", "answered"] },
  });
  if (existingActive) {
    throw new AppError(
      StatusCodes.CONFLICT,
      "You already have an active call. End it before starting a new one.",
    );
  }

  // 3. Check user has credits
  const balance = await CreditRepository.getBalance(userId);
  if (!balance || balance.balance <= 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Insufficient credits. Top up to make calls.",
    );
  }

  // 4. Check show is active (same timezone logic as messages)
  const countryId = (station.country as any)?._id || station.country;
  const country = await Country.findById(countryId).lean();
  const timezone = country?.timezone || "UTC";

  const activeShow = await ShowRepository.findActiveShowForStation(stationId, timezone);
  if (!activeShow) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "No active show right now. Please try again during show hours.",
    );
  }

  // 5. Check operators are online
  const availableOperators = await getAvailableOperatorCount(stationId);
  if (availableOperators === 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "No operators online. Please try again later.",
    );
  }

  // 6. Deduct credit (call reached the station → credit cut)
  const agoraChannelId = `call_${stationId}_${userId}_${Date.now()}`;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const call = await Call.create(
      [{
        station: stationId,
        show: activeShow._id,
        startedBy: userId,
        agoraChannelId,
        status: "queued",
        creditsUsed: 1,
        country: countryId,
        waitStartedAt: new Date(),
        startedAt: new Date(),
      }],
      { session },
    );

    const { balance: updatedBalance } = await CreditService.deductCredits(
      userId,
      1,
      stationId,
      call[0]!._id.toString(),
      "call",
      session,
    );

    await session.commitTransaction();

    // Start queue timeout
    startQueueTimeout(call[0]!._id.toString(), userId, stationId);

    // Emit incoming-call to station room (all operators see it)
    const user = await User.findById(userId).select("fullName phone").lean();
    emitToStation(stationId, "incoming-call", {
      callId: call[0]!._id.toString(),
      callerName: user?.fullName || "Unknown",
      callerPhone: user?.phone || "",
      showName: activeShow.name,
    });

    logger.info(`[Call] Call requested: ${call[0]!._id} by user ${userId} to station ${stationId}`);

    return {
      callId: call[0]!._id.toString(),
      channelName: agoraChannelId,
      status: "queued",
      remainingBalance: updatedBalance,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// ─── Accept Call (Operator picks up) ─────────────────────────────────────────

const acceptCall = async (callId: string, operatorId: string) => {
  const call = await Call.findById(callId);
  if (!call) {
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found");
  }

  // Station-scope authorization
  const operator = await User.findById(operatorId).select("stationId role fullName").lean();
  if (!operator) {
    throw new AppError(StatusCodes.NOT_FOUND, "Operator not found");
  }
  if (operator.role !== "super_admin") {
    const operatorStationId = operator.stationId?.toString();
    if (!operatorStationId || operatorStationId !== call.station.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only accept calls from your own station.");
    }
  }

  // Atomic: only accept if still queued (prevents race condition with two operators)
  const result = await Call.findOneAndUpdate(
    { _id: callId, status: "queued" },
    {
      $set: {
        status: "answered",
        handledBy: operatorId,
        answeredAt: new Date(),
      },
    },
    { new: true },
  );

  if (!result) {
    const current = await Call.findById(callId);
    if (current?.status === "cancelled") {
      throw new AppError(StatusCodes.CONFLICT, "Call was cancelled by the caller.");
    }
    if (current?.status === "missed") {
      throw new AppError(StatusCodes.CONFLICT, "Call already timed out.");
    }
    throw new AppError(StatusCodes.CONFLICT, "Call already accepted by another operator.");
  }

  // Clear queue timeout
  clearQueueTimeout(callId);

  // Mark operator as on a call
  await setOperatorOnCall(operatorId, callId);

  // Generate Agora token for operator (UID = operator's numeric hash, never 0)
  const operatorUid = Math.abs(
    operatorId.split("").reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0),
  ) || 1;
  const token = generateAgoraToken(result.agoraChannelId, operatorUid);

  // Start join-confirmation timeout
  startJoinTimeout(callId, result.startedBy.toString(), result.station.toString(), operatorId);

  // Notify caller that call was accepted
  emitToUser(result.startedBy.toString(), "call-accepted", {
    callId,
    channelName: result.agoraChannelId,
    token,
    operatorName: operator.fullName || "Operator",
  });

  // Notify station that call was taken (hide from others)
  emitToStation(result.station.toString(), "call-removed", { callId });

  logger.info(`[Call] Call accepted: ${callId} by operator ${operatorId}`);

  return {
    callId,
    channelName: result.agoraChannelId,
    token,
    status: "answered",
  };
};

// ─── Join Call (User confirms Agora connection) ──────────────────────────────

const joinCall = async (callId: string, userId: string) => {
  const call = await Call.findById(callId);
  if (!call) {
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found");
  }

  if (call.startedBy.toString() !== userId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only join your own call.");
  }

  if (call.status !== "answered") {
    throw new AppError(StatusCodes.BAD_REQUEST, "Call is not in an answerable state.");
  }

  // Clear join-confirmation timeout
  clearJoinTimeout(callId);

  // Generate token for user (UID never 0)
  const userUid = Math.abs(
    userId.split("").reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0),
  ) || 1;
  const token = generateAgoraToken(call.agoraChannelId, userUid);

  logger.info(`[Call] User joined call: ${callId}`);

  return {
    callId,
    channelName: call.agoraChannelId,
    token,
  };
};

// ─── End Call (Either party hangs up) ────────────────────────────────────────

const endCall = async (callId: string, userId: string) => {
  const call = await Call.findById(callId);
  if (!call) {
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found");
  }

  // Only caller or handler can end the call
  const isCaller = call.startedBy.toString() === userId;
  const isHandler = call.handledBy?.toString() === userId;
  if (!isCaller && !isHandler) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only end your own call.");
  }

  // Can't end if already ended
  if (["missed", "rejected", "cancelled"].includes(call.status)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Call already ended.");
  }

  const endedAt = new Date();
  const duration = call.answeredAt
    ? Math.floor((endedAt.getTime() - call.answeredAt.getTime()) / 1000)
    : 0;

  // Preserve status: answered stays answered, queued becomes missed
  const finalStatus = call.status === "answered" ? "answered" : "missed";

  const result = await Call.findByIdAndUpdate(
    callId,
    {
      $set: {
        status: finalStatus,
        endedAt,
        duration,
      },
    },
    { new: true },
  );

  // If call was answered and operator was on it, clean up
  if (call.handledBy) {
    await removeOperatorOnCall(call.handledBy.toString());
  }

  // Clear any pending timeouts
  clearJoinTimeout(callId);
  clearQueueTimeout(callId);

  // Notify both parties
  emitToUser(call.startedBy.toString(), "call-ended", {
    callId,
    duration,
    creditsUsed: call.creditsUsed,
  });
  if (call.handledBy) {
    emitToUser(call.handledBy.toString(), "call-ended", {
      callId,
      duration,
      creditsUsed: call.creditsUsed,
    });
  }

  logger.info(`[Call] Call ended: ${callId}, duration: ${duration}s`);

  return {
    callId,
    status: result?.status || call.status,
    duration,
    creditsUsed: call.creditsUsed,
  };
};

// ─── Cancel Call (User backs out while queued) ───────────────────────────────

const cancelCall = async (callId: string, userId: string) => {
  const result = await Call.findOneAndUpdate(
    { _id: callId, startedBy: userId, status: "queued" },
    { $set: { status: "cancelled", endedAt: new Date() } },
    { new: true },
  );

  if (!result) {
    const call = await Call.findById(callId);
    if (call?.status === "answered") {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Call was just answered. You are now connected.",
      );
    }
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found or already ended.");
  }

  // Clear queue timeout
  clearQueueTimeout(callId);

  // Notify station
  emitToStation(result.station.toString(), "call-cancelled", { callId });

  logger.info(`[Call] Call cancelled: ${callId} by user ${userId}`);

  return { callId, status: "cancelled" };
};

// ─── Call History ────────────────────────────────────────────────────────────

const getCallHistory = async (
  userId: string,
  page: number = 1,
  limit: number = 20,
) => {
  const skip = (page - 1) * limit;

  const [calls, total] = await Promise.all([
    Call.find({ startedBy: userId })
      .populate("station", "name stationCode category logo")
      .populate("show", "name")
      .populate("handledBy", "fullName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Call.countDocuments({ startedBy: userId }),
  ]);

  return {
    calls,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

// ─── Dashboard: Get station calls ────────────────────────────────────────────

const getStationCalls = async (
  stationId: string,
  page: number = 1,
  limit: number = 20,
  status?: string,
) => {
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;

  const [calls, total] = await Promise.all([
    Call.find(filter)
      .populate("startedBy", "fullName phone")
      .populate("show", "name")
      .populate("handledBy", "fullName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Call.countDocuments(filter),
  ]);

  return {
    calls,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const CallService = {
  // Operator status
  setOperatorOnline,
  refreshOperatorOnline,
  removeOperatorOnline,
  setOperatorOnCall,
  removeOperatorOnCall,
  isOperatorOnCall,

  // Call lifecycle
  requestCall,
  acceptCall,
  joinCall,
  endCall,
  cancelCall,

  // Queries
  getCallHistory,
  getStationCalls,

  // Token generation (exposed for socket handlers)
  generateAgoraToken,
};
