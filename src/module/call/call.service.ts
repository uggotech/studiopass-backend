import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import AppError from "../../errors/AppError";
import Call from "./call.model";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "../show/show.repository";
import { CreditService } from "../credit/credit.service";
import { CreditRepository } from "../credit/credit.repository";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import { Country } from "../country/country.model";
import { User } from "../user/user.model";
import redisClient from "../../redis/redisClient";
import config from "../../config";
import { logger } from "../../logger/logger";
import {
  emitToStationCalls,
  emitToUser,
  getIO,
} from "../../socket";
import { ListenerStatementService } from "../listenerStatement/listenerStatement.service";
import { CarrierService } from "../../shared/telecom/carrier.service";

// ─── Shared Call Helpers ────────────────────────────────────────────────────
// Single source of truth for refund, statement, and notification logic.
// Every code path that ends a call MUST use these helpers.

/**
 * Refund credits if the call was still queued (not answered).
 * Safe to call multiple times — checks call status before refunding.
 */
const refundIfQueued = async (
  callId: string,
  startedBy: string,
  creditsUsed: number,
  station: string,
): Promise<void> => {
  if (creditsUsed <= 0) return;
  try {
    // Atomic update: only reset creditsUsed to 0 if it is currently > 0 and status is refundable
    const updatedCall = await Call.findOneAndUpdate(
      {
        _id: callId,
        status: { $in: ["queued", "missed", "cancelled", "rejected"] },
        creditsUsed: { $gt: 0 },
      },
      { $set: { creditsUsed: 0 } },
      { returnDocument: "before" },
    );

    if (!updatedCall) {
      logger.info(`[Call] Skipping refund for ${callId} — already refunded or status not refundable`);
      return;
    }

    const actualCreditsToRefund = updatedCall.creditsUsed || creditsUsed;
    try {
      await CreditService.refundCredits(startedBy, actualCreditsToRefund, station, callId, "call");
      logger.info(`[Call] Refunded ${actualCreditsToRefund} credit(s) for call: ${callId}`);
    } catch (refundErr) {
      // Refund failed after we zeroed creditsUsed: put it back so the periodic sweep can retry
      // (otherwise the credit would be lost with no way to recover it).
      await Call.updateOne(
        { _id: callId, creditsUsed: 0 },
        { $set: { creditsUsed: actualCreditsToRefund } },
      ).catch(() => undefined);
      throw refundErr;
    }
  } catch (err) {
    logger.error(`[Call] Refund failed for ${callId}:`, err);
  }
};

/**
 * Create a listener statement for answered calls (non-critical).
 * Looks up isFree from the CreditTransaction. Safe to call multiple times (idempotent).
 */
const createStatementIfNeeded = async (callId: string): Promise<void> => {
  try {
    const creditTx = await CreditTransaction.findOne({ resourceId: callId, type: "call_deduction" })
      .select("isFree")
      .lean();
    const isFree = creditTx?.isFree ?? false;
    await ListenerStatementService.createStatementFromCall(callId, isFree);
  } catch (err) {
    logger.error(`[Call] Listener statement creation failed for ${callId}:`, err);
  }
};

/**
 * Emit call-ended to all relevant parties (user, operator, station).
 */
const emitCallEnded = (
  callId: string,
  stationId: string,
  startedBy: string,
  handledBy?: string,
  reason: string = "ended",
  message: string = "Call ended.",
  duration: number = 0,
  creditsUsed: number = 0,
): void => {
  emitToUser(startedBy, "call-ended", { callId, reason, message, duration, creditsUsed });
  if (handledBy) {
    emitToUser(handledBy, "call-ended", { callId, reason, message, duration, creditsUsed });
  }
  // Call events go only to the Media Station call room (never the public station room)
  emitToStationCalls(stationId, "call-ended", { callId, reason, message, duration, creditsUsed });
};

// ─── Timeout Maps ────────────────────────────────────────────────────────────
const callQueueTimeouts = new Map<string, NodeJS.Timeout>();
const callJoinTimeouts = new Map<string, NodeJS.Timeout>();

// ─── Operator Status Helpers ─────────────────────────────────────────────────

const setOperatorOnline = async (userId: string): Promise<void> => {
  try {
    await redisClient.set(`operator:${userId}:online`, "1", 60);
  } catch (err) {
    logger.warn(`[Call] Redis unavailable for setOperatorOnline: ${err}`);
  }
};

const refreshOperatorOnline = async (userId: string): Promise<void> => {
  try {
    if (await redisClient.get(`operator:${userId}:online`)) {
      await redisClient.set(`operator:${userId}:online`, "1", 60);
    }
  } catch (err) {
    logger.warn(`[Call] Redis unavailable for refreshOperatorOnline: ${err}`);
  }
};

const removeOperatorOnline = async (userId: string): Promise<void> => {
  try {
    await redisClient.delete(`operator:${userId}:online`);
  } catch (err) {
    logger.warn(`[Call] Redis unavailable for removeOperatorOnline: ${err}`);
  }
};

const setOperatorOnCall = async (userId: string, callId: string): Promise<void> => {
  try {
    // TTL of 2 hours as safety net — prevents stale keys after server crash
    await redisClient.set(`operator:${userId}:on_call`, callId, 7200);
  } catch (err) {
    logger.warn(`[Call] Redis unavailable for setOperatorOnCall: ${err}`);
  }
};

/**
 * Clear the operator's "on call" marker.
 * When `onlyIfCallId` is given, the marker is cleared only if it still points at that call,
 * so ending an old call can never wipe the marker of the call the operator switched to.
 */
const removeOperatorOnCall = async (userId: string, onlyIfCallId?: string): Promise<void> => {
  try {
    const key = `operator:${userId}:on_call`;
    if (onlyIfCallId) {
      const current = await redisClient.get(key);
      if (current && current !== onlyIfCallId) return;
    }
    await redisClient.delete(key);
  } catch (err) {
    logger.warn(`[Call] Redis unavailable for removeOperatorOnCall: ${err}`);
  }
};

const isOperatorOnCall = async (userId: string): Promise<boolean> => {
  try {
    const callId = await redisClient.get(`operator:${userId}:on_call`);
    return !!callId;
  } catch (err) {
    // Redis down — assume not on call (fail-open for availability)
    return false;
  }
};

const getOperatorOnCallId = async (userId: string): Promise<string | null> => {
  try {
    const marked = await redisClient.get(`operator:${userId}:on_call`);
    if (marked) return marked;
  } catch (err) {
    // Redis down: fall through to the database
  }
  // Redis down, restarted/flushed mid-call, or the key expired: the database is the source of
  // truth, so a switch / disconnect still finds the live call (indexed on {handledBy, status}).
  try {
    const live = await Call.findOne({ handledBy: userId, status: "answered" })
      .sort({ answeredAt: -1 })
      .select("_id")
      .lean();
    return live ? live._id.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Check how many operators are connected to the station socket room.
 * Connected = active socket connection in the station room.
 */
// Only Media Station accounts can take calls (presenter / station admin / super admin cannot).
const OPERATOR_ROLES = ["media_station"];

/** Distinct Media Station users connected to the station's call room. */
const getConnectedOperatorIds = (stationId: string): string[] => {
  const io = getIO();
  const sockets = io.sockets.adapter.rooms.get(`station-calls:${stationId}`);
  if (!sockets || sockets.size === 0) return [];

  const userIdSet = new Set<string>();
  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    const userRole = (socket as any).userRole;
    if (!OPERATOR_ROLES.includes(userRole)) continue;
    const userId = (socket as any).userId;
    if (!userId) continue;
    userIdSet.add(userId);
  }
  return [...userIdSet];
};

const getConnectedOperatorCount = (stationId: string): number =>
  getConnectedOperatorIds(stationId).length;

/**
 * Check how many operators are available for a station.
 * Available = connected to station socket room AND not on a call.
 */
const getAvailableOperatorCount = async (stationId: string): Promise<number> => {
  // Distinct operators (one operator may have multiple socket connections)
  const userIds = getConnectedOperatorIds(stationId);

  if (userIds.length === 0) return 0;

  // Parallel Redis checks
  const onCallResults = await Promise.all(
    userIds.map((uid) => isOperatorOnCall(uid)),
  );

  return onCallResults.filter((onCall) => !onCall).length;
};

// ─── Token Generation ────────────────────────────────────────────────────────

const generateAgoraToken = (
  channelName: string,
  uid: number,
  isPublisher: boolean = true,
): string => {
  const appId = config.agora.app_id;
  const appCertificate = config.agora.app_certificate;

  if (!appId || !appCertificate) {
    throw new AppError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      "Agora credentials not configured",
    );
  }

  const role = isPublisher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

  return RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    uid,
    role,
    3600, // token expires in 1 hour (relative duration, not absolute timestamp)
    3600, // privilege expires in 1 hour (must match token expiry)
  );
};

// ─── Queue Timeout ───────────────────────────────────────────────────────────

const startQueueTimeout = (
  callId: string,
  userId: string,
  stationId: string,
  timeoutMs: number = config.calls.queue_timeout_ms,
): void => {
  // Never keep two timers for the same call
  clearQueueTimeout(callId);

  const timeoutId = setTimeout(async () => {
    try {
      const result = await Call.findOneAndUpdate(
        { _id: callId, status: "queued" },
        { $set: { status: "missed", endedAt: new Date() } },
        { returnDocument: "after" },
      );

      if (result) {
        await refundIfQueued(callId, userId, result.creditsUsed, stationId);
        emitToUser(userId, "call-ended", {
          callId,
          reason: "timeout",
          message: "The station was unable to take your call. Please try again later.",
        });
        emitToStationCalls(stationId, "call-cancelled", { callId });
        emitToStationCalls(stationId, "call-removed", { callId });
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
  timeoutMs: number = config.calls.join_confirmation_timeout_ms,
): void => {
  clearJoinTimeout(callId);

  const timeoutId = setTimeout(async () => {
    try {
      const result = await Call.findOneAndUpdate(
        { _id: callId, status: "answered" },
        { $set: { status: "missed", endedAt: new Date() } },
        { returnDocument: "after" },
      );

      if (result) {
        await refundIfQueued(callId, userId, result.creditsUsed, stationId);
        await removeOperatorOnCall(operatorId, callId);
        emitCallEnded(callId, stationId, userId, operatorId, "join_timeout", "Call ended — connection not established.");
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

  // 5. Check at least one operator is online in the station room
  const connectedOperators = getConnectedOperatorCount(stationId);
  if (connectedOperators === 0) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "No operators online. Please try again later.",
    );
  }

  // 6. Deduct credit (call reached the station → credit cut)
  const agoraChannelId = `c_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const callerUser = await User.findById(userId).select("phone").lean();
    const operator = CarrierService.detectOperator(callerUser?.phone, country?.code || "UG") || undefined;

    const call = await Call.create(
      [{
        station: stationId,
        show: activeShow._id,
        startedBy: userId,
        agoraChannelId,
        status: "queued",
        creditsUsed: 1,
        country: countryId,
        operator,
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
    emitToStationCalls(stationId, "incoming-call", {
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

// ─── System / forced termination ─────────────────────────────────────────────

/**
 * End a call that is still queued or answered, from the server side
 * (operator switched, socket grace expired, show ended, ...).
 *
 * One atomic status change decides the winner, so it is safe to call from several
 * places at once: only the first caller does the work, everyone else gets null.
 *  - queued   -> missed     (credit refunded)
 *  - answered -> completed  (listener statement created)
 * Operator marker, timers and socket events are all handled here so every code path
 * ends a call in exactly the same way.
 */
const endCallBySystem = async (
  callId: string,
  reason: string,
  message: string,
  options: { handledBy?: string } = {},
) => {
  const endedAt = new Date();
  const filter: Record<string, unknown> = {
    _id: callId,
    status: { $in: ["queued", "answered"] },
  };
  if (options.handledBy) filter.handledBy = options.handledBy;

  const result = await Call.findOneAndUpdate(
    filter,
    [
      {
        $set: {
          status: { $cond: [{ $eq: ["$status", "answered"] }, "completed", "missed"] },
          endedAt,
          duration: {
            $cond: [
              { $ne: ["$answeredAt", null] },
              {
                $max: [
                  0,
                  { $floor: { $divide: [{ $subtract: [endedAt, "$answeredAt"] }, 1000] } },
                ],
              },
              0,
            ],
          },
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true },
  );

  if (!result) return null;

  clearQueueTimeout(callId);
  clearJoinTimeout(callId);

  const startedBy = result.startedBy.toString();
  const stationId = result.station.toString();
  const handledBy = result.handledBy?.toString();

  if (result.status === "missed") {
    await refundIfQueued(callId, startedBy, result.creditsUsed, stationId);
  }
  if (handledBy) {
    await removeOperatorOnCall(handledBy, callId);
  }
  if (result.status === "completed") {
    await createStatementIfNeeded(callId);
  }

  emitCallEnded(
    callId,
    stationId,
    startedBy,
    handledBy,
    reason,
    message,
    result.duration || 0,
    result.status === "missed" ? 0 : result.creditsUsed,
  );
  if (result.status === "missed") {
    // Make sure it disappears from every open waiting queue
    emitToStationCalls(stationId, "call-removed", { callId });
  }

  logger.info(`[Call] Call ${callId} ended by system (${reason}) -> ${result.status}`);
  return result;
};

/**
 * End every live (queued or answered) call of a station — used when a show ends.
 * Queued callers are refunded, the on-air caller is completed.
 */
const endAllActiveCallsForStation = async (
  stationId: string,
  reason: string,
  message: string,
): Promise<number> => {
  const active = await Call.find({
    station: stationId,
    status: { $in: ["queued", "answered"] },
  })
    .select("_id")
    .lean();

  let ended = 0;
  for (const call of active) {
    try {
      const done = await endCallBySystem(call._id.toString(), reason, message);
      if (done) ended++;
    } catch (err) {
      logger.error(`[Call] Failed to end call ${call._id} (${reason}):`, err);
    }
  }
  if (ended > 0) {
    logger.info(`[Call] ${ended} call(s) ended for station ${stationId} (${reason})`);
  }
  return ended;
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

  // Build credentials BEFORE touching any call, so a misconfiguration (or any failure here)
  // can never leave the presenter without their current caller and without the new one.
  // UID range 1000000–1999999 is disjoint from the listener range.
  const operatorUid = (((operatorId.split("").reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0) >>> 0) % 1000000) + 1000000);
  const token = generateAgoraToken(call.agoraChannelId, operatorUid, true);

  // Remember the current call of this operator (if any) before we change anything
  const previousCallId = await getOperatorOnCallId(operatorId);

  // 1) Claim the NEW caller first. Atomic: only succeeds if it is still queued
  //    (also prevents two operators accepting the same call).
  const result = await Call.findOneAndUpdate(
    { _id: callId, status: "queued" },
    {
      $set: {
        status: "answered",
        handledBy: operatorId,
        answeredAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  if (!result) {
    // Nothing was changed: the presenter keeps their current caller
    const current = await Call.findById(callId);
    if (current?.status === "cancelled") {
      throw new AppError(StatusCodes.CONFLICT, "Call was cancelled by the caller.");
    }
    if (current?.status === "missed") {
      throw new AppError(StatusCodes.CONFLICT, "Call already timed out.");
    }
    throw new AppError(StatusCodes.CONFLICT, "Call already accepted by another operator.");
  }

  clearQueueTimeout(callId);

  // 2) New caller secured -> now end the previous one (switch).
  //    Guarded by handledBy so we can only ever end a call that this operator is handling.
  if (previousCallId && previousCallId !== callId) {
    logger.info(`[Call] Operator ${operatorId} switching from active call ${previousCallId} to new call ${callId}`);
    try {
      await endCallBySystem(previousCallId, "switched", "Presenter switched to another caller.", {
        handledBy: operatorId,
      });
    } catch (switchErr) {
      logger.error(`[Call] Error ending previous call ${previousCallId} during switch:`, switchErr);
    }
  }

  // 3) Mark operator as on the new call and wait for the listener to join
  await setOperatorOnCall(operatorId, callId);
  startJoinTimeout(callId, result.startedBy.toString(), result.station.toString(), operatorId);

  // Notify caller that call was accepted (no token — user gets their own via joinCall)
  emitToUser(result.startedBy.toString(), "call-accepted", {
    callId,
    channelName: result.agoraChannelId,
    operatorName: operator.fullName || "Operator",
  });

  // Notify station that call was taken (hide from other operators)
  emitToStationCalls(result.station.toString(), "call-removed", { callId });

  logger.info(`[Call] Call accepted: ${callId} by operator ${operatorId}`);

  return {
    callId,
    channelName: result.agoraChannelId,
    token,
    operatorUid,
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

  // Generate token for user (UID in range 1–999999, disjoint from operator range 1000000–1999999)
  const userUid = (((userId.split("").reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0) >>> 0) % 999999) + 1) || 1;
  const token = generateAgoraToken(call.agoraChannelId, userUid, true);

  logger.info(`[Call] User joined call: ${callId}`);

  return {
    callId,
    channelName: call.agoraChannelId,
    token,
    userUid,
  };
};

// ─── End Call (Either party hangs up) ────────────────────────────────────────

const endCall = async (callId: string, userId: string, webrtcDuration?: number) => {
  // Atomic: only end if not already ended AND user is caller/handler (prevents unauthorized end)
  const endedAt = new Date();
  const durationExpression =
    typeof webrtcDuration === "number" && webrtcDuration >= 0
      ? webrtcDuration
      : {
          $cond: [
            { $ne: ["$answeredAt", null] },
            {
              $divide: [
                { $subtract: [endedAt, "$answeredAt"] },
                1000,
              ],
            },
            0,
          ],
        };

  const result = await Call.findOneAndUpdate(
    {
      _id: callId,
      status: { $nin: ["missed", "rejected", "cancelled", "completed"] },
      $or: [{ startedBy: userId }, { handledBy: userId }],
    },
    [
      {
        $set: {
          status: {
            $cond: [{ $eq: ["$status", "answered"] }, "completed", "missed"],
          },
          endedAt,
          duration: durationExpression,
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true },
  );

  if (!result) {
    // Call was already ended, not found, or user is not authorized
    const existing = await Call.findById(callId);
    if (!existing) {
      throw new AppError(StatusCodes.NOT_FOUND, "Call not found");
    }
    const isCaller = existing.startedBy.toString() === userId;
    const isHandler = existing.handledBy?.toString() === userId;
    if (!isCaller && !isHandler) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only end your own call.");
    }
    // Already ended — return success instead of error
    if (["completed", "missed", "cancelled", "rejected"].includes(existing.status)) {
      return {
        callId,
        status: existing.status,
        duration: existing.duration || 0,
        creditsUsed: existing.creditsUsed || 0,
      };
    }
    throw new AppError(StatusCodes.BAD_REQUEST, "Call already ended.");
  }

  const duration = result.duration || 0;

  // Refund credits if call was queued (user ended before it was answered)
  if (result.status === "missed") {
    await refundIfQueued(callId, result.startedBy.toString(), result.creditsUsed, result.station.toString());
  }

  // If call was answered and operator was on it, clean up
  if (result.handledBy) {
    await removeOperatorOnCall(result.handledBy.toString(), callId);
  }

  // Clear any pending timeouts
  clearJoinTimeout(callId);
  clearQueueTimeout(callId);

  // Notify all parties
  emitCallEnded(
    callId,
    result.station.toString(),
    result.startedBy.toString(),
    result.handledBy?.toString(),
    "ended",
    "Call ended.",
    duration,
    result.creditsUsed,
  );

  logger.info(`[Call] Call ended: ${callId}, duration: ${duration}s`);

  // Create listener statement for answered calls (non-critical)
  if (result.status === "completed") {
    await createStatementIfNeeded(callId);
  }

  return {
    callId,
    status: result.status,
    duration,
    creditsUsed: result.creditsUsed,
  };
};

// ─── Cancel Call (User backs out while queued) ───────────────────────────────

const cancelCall = async (callId: string, userId: string) => {
  const call = await Call.findById(callId);
  if (!call) throw new AppError(StatusCodes.NOT_FOUND, "Call not found");
  if (call.startedBy.toString() !== userId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only cancel your own call.");
  }
  if (["completed", "missed", "cancelled", "rejected"].includes(call.status)) {
    return { callId, status: call.status };
  }
  // If call was already answered by operator, treat user cancellation as endCall
  if (call.status === "answered") {
    logger.info(`[Call] User ${userId} cancelled answered call ${callId} — delegating to endCall`);
    return await endCall(callId, userId);
  }

  const result = await Call.findOneAndUpdate(
    { _id: callId, startedBy: userId, status: "queued" },
    { $set: { status: "cancelled", endedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!result) {
    const freshCall = await Call.findById(callId);
    if (freshCall?.status === "answered") {
      logger.info(`[Call] User ${userId} cancelled answered call ${callId} — delegating to endCall`);
      return await endCall(callId, userId);
    }
    if (freshCall?.status && ["completed", "missed", "cancelled", "rejected"].includes(freshCall.status)) {
      return { callId, status: freshCall.status };
    }
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found or already ended.");
  }

  // Clear queue timeout
  clearQueueTimeout(callId);

  // Refund credit if it was reserved but not charged
  await refundIfQueued(callId, userId, result.creditsUsed, result.station.toString());

  // Notify the Media Station call room
  emitToStationCalls(result.station.toString(), "call-cancelled", { callId });
  emitToStationCalls(result.station.toString(), "call-removed", { callId });

  logger.info(`[Call] Call cancelled: ${callId} by user ${userId}`);

  return { callId, status: "cancelled" };
};

// ─── Reject Call (Station Operator cuts/declines an incoming call) ────────────────

const rejectCall = async (callId: string, operatorId: string, reason?: string) => {
  // 0. Station-scope authorization: an operator can only cut calls of their own station
  const [target, operator] = await Promise.all([
    Call.findById(callId).select("station").lean(),
    User.findById(operatorId).select("stationId role").lean(),
  ]);
  if (!target) {
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found or already ended.");
  }
  if (!operator) {
    throw new AppError(StatusCodes.NOT_FOUND, "Operator not found");
  }
  if (operator.role !== "super_admin") {
    const operatorStationId = operator.stationId?.toString();
    if (!operatorStationId || operatorStationId !== target.station.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only decline calls from your own station.");
    }
  }

  // 1. Atomically update call status to 'rejected'
  const result = await Call.findOneAndUpdate(
    { _id: callId, status: "queued" },
    {
      $set: {
        status: "rejected",
        handledBy: operatorId,
        endedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  if (!result) {
    const call = await Call.findById(callId);
    if (call?.status === "answered" || call?.status === "completed") {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        "Call was already answered or completed.",
      );
    }
    throw new AppError(StatusCodes.NOT_FOUND, "Call not found or already ended.");
  }

  // 2. Clear queue timeout
  clearQueueTimeout(callId);

  // 3. Refund credit to listener
  await refundIfQueued(
    callId,
    result.startedBy.toString(),
    result.creditsUsed || 1,
    result.station.toString(),
  );

  // 4. Notify listener & station via WebSocket
  emitCallEnded(
    callId,
    result.station.toString(),
    result.startedBy.toString(),
    operatorId,
    "rejected",
    reason || "Call cut by station operator. Credit refunded.",
    0,
    0,
  );

  logger.info(`[Call] Call rejected/cut: ${callId} by operator ${operatorId}`);

  return { callId, status: "rejected" };
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
      .populate("station", "name stationCode category logo country isActive isVerified")
      .populate("show", "name")
      .populate("handledBy", "fullName")
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Call.countDocuments({ startedBy: userId }),
  ]);

  // Batch-fetch timezones for unique countries (avoids N+1)
  let tzMap = new Map<string, string>();
  try {
    const uniqueCountryIds = [
      ...new Set(
        calls
          .map((call: any) => {
            const country = call.station?.country;
            return country?._id?.toString() || country?.toString() || null;
          })
          .filter(Boolean),
      ),
    ];

    if (uniqueCountryIds.length > 0) {
      const { Country } = await import("../country/country.model");
      const countries = await Country.find({ _id: { $in: uniqueCountryIds } })
        .select("timezone")
        .lean();
      tzMap = new Map(
        countries.map((c: any) => [c._id.toString(), c.timezone || "UTC"]),
      );
    }
  } catch (err) {
    logger.warn("[Call] Failed to resolve timezone for call history:", err);
  }

  const enrichedCalls = calls.map((call: any) => ({
    ...call,
    stationTimezone:
      tzMap.get(
        call.station?.country?._id?.toString() ||
          call.station?.country?.toString() ||
          "",
      ) || "UTC",
  }));

  return {
    calls: enrichedCalls,
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
  showId?: string,
  todayOnly?: boolean,
) => {
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = { station: stationId };
  if (status) {
    const statuses = status.split(",").map((s: string) => s.trim()).filter(Boolean);
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  if (showId) {
    filter.show = showId;
  }

  // Fetch station timezone
  let stationTimezone = "UTC";
  try {
    const { Station } = await import("../station/station.model");
    const { Country } = await import("../country/country.model");
    const station = await Station.findById(stationId).select("country").lean();
    const countryId = (station as any)?.country;
    if (countryId) {
      const country = await Country.findById(countryId).select("timezone").lean();
      stationTimezone = (country as any)?.timezone || "UTC";
    }
  } catch (err) {
    logger.warn(`[Call] Failed to resolve timezone for station ${stationId}:`, err);
  }

  if (showId && todayOnly) {
    try {
      const { Show } = await import("../show/show.model");
      const { getShowStartTimestamp } = await import("../show/show.service");
      const show = await Show.findById(showId).lean();
      if (show) {
        const showStart = getShowStartTimestamp(show.startTime, show.endTime, stationTimezone);
        filter.startedAt = { $gte: showStart };
      }
    } catch (err) {
      logger.warn(`[Call] Failed to resolve show start for show ${showId}:`, err);
    }
  }

  const [calls, total] = await Promise.all([
    Call.find(filter)
      .populate("startedBy", "fullName phone avatar")
      .populate("show", "name")
      .populate("handledBy", "fullName")
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Call.countDocuments(filter),
  ]);

  // Attach timezone to each call
  const enrichedCalls = calls.map((call: any) => ({
    ...call,
    stationTimezone,
  }));

  return {
    calls: enrichedCalls,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

// ─── Startup Cleanup ────────────────────────────────────────────────────────

/**
 * Clean up stale calls (orphans left by a crash / restart). Runs on startup and periodically.
 * Every call is ended through endCallBySystem, so status, refund, statement, operator marker
 * and socket events are handled exactly like any other call ending.
 */
const cleanupStaleCalls = async (): Promise<void> => {
  try {
    const queueTimeoutMs = config.calls.queue_timeout_ms;
    const now = new Date();
    let queuedCleaned = 0;
    let answeredCleaned = 0;
    let refundsRecovered = 0;

    // Stale queued calls — missed + refund
    const staleQueuedCalls = await Call.find({
      status: "queued",
      createdAt: { $lt: new Date(now.getTime() - queueTimeoutMs) },
    })
      .select("_id")
      .lean();

    for (const call of staleQueuedCalls) {
      try {
        const done = await endCallBySystem(
          call._id.toString(),
          "timeout",
          "The station was unable to take your call. Please try again later.",
        );
        if (done) queuedCleaned++;
      } catch (err) {
        logger.error(`[Call] Cleanup failed for queued call ${call._id}:`, err);
      }
    }

    // Stale answered calls (4+ hours — well above the Redis on_call TTL of 2h) — completed
    const staleAnsweredThresholdMs = 4 * 60 * 60 * 1000;
    const staleAnsweredCalls = await Call.find({
      status: "answered",
      answeredAt: { $lt: new Date(now.getTime() - staleAnsweredThresholdMs) },
    })
      .select("_id")
      .lean();

    for (const call of staleAnsweredCalls) {
      try {
        const done = await endCallBySystem(call._id.toString(), "timeout", "Call expired.");
        if (done) answeredCleaned++;
      } catch (err) {
        logger.error(`[Call] Cleanup failed for answered call ${call._id}:`, err);
      }
    }

    // Recover refunds that failed (refundIfQueued puts creditsUsed back when a refund throws).
    // Only recent calls, and only if no refund transaction exists yet — never double refund.
    const unrefunded = await Call.find({
      status: { $in: ["missed", "cancelled", "rejected"] },
      creditsUsed: { $gt: 0 },
      endedAt: {
        $lt: new Date(now.getTime() - 2 * 60 * 1000),
        $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
    })
      .select("_id startedBy station creditsUsed")
      .limit(100)
      .lean();

    for (const call of unrefunded) {
      try {
        const alreadyRefunded = await CreditTransaction.exists({
          resourceId: call._id,
          type: "call_refund",
        });
        if (alreadyRefunded) {
          // Credit was already returned earlier; just reconcile the call record
          await Call.updateOne({ _id: call._id }, { $set: { creditsUsed: 0 } });
          continue;
        }
        await refundIfQueued(
          call._id.toString(),
          call.startedBy.toString(),
          call.creditsUsed,
          call.station.toString(),
        );
        refundsRecovered++;
      } catch (err) {
        logger.error(`[Call] Refund recovery failed for call ${call._id}:`, err);
      }
    }

    if (queuedCleaned > 0 || answeredCleaned > 0 || refundsRecovered > 0) {
      logger.info(
        `[Call] Cleanup: ${queuedCleaned} queued → missed, ${answeredCleaned} answered → completed, ${refundsRecovered} refund(s) recovered`,
      );
    }
  } catch (err) {
    logger.error("[Call] Cleanup error:", err);
  }
};

/**
 * Re-register timeouts for active calls after a server restart.
 * Called once after cleanupStaleCalls. Uses the same timeout functions as normal operation.
 */
const reregisterTimeouts = async (): Promise<void> => {
  try {
    // 1. Queue timeouts for calls still waiting
    const queuedCalls = await Call.find({ status: "queued" })
      .select("_id startedBy station createdAt")
      .lean();

    let queuedRegistered = 0;
    for (const call of queuedCalls) {
      const elapsed = Date.now() - (call.createdAt?.getTime() ?? call._id.getTimestamp().getTime());
      const remainingMs = config.calls.queue_timeout_ms - elapsed;
      if (remainingMs > 0) {
        logger.info(`[Call] Re-registering queue timeout for ${call._id} (${remainingMs}ms remaining)`);
        startQueueTimeout(
          call._id.toString(),
          call.startedBy.toString(),
          call.station.toString(),
          remainingMs,
        );
        queuedRegistered++;
      }
    }

    // 2. Join-confirmation timeouts for just-accepted calls
    const answeredCalls = await Call.find({
      status: "answered",
      handledBy: { $exists: true, $ne: null },
    })
      .select("_id startedBy station handledBy answeredAt")
      .lean();

    let answeredRegistered = 0;
    for (const call of answeredCalls) {
      const elapsed = call.answeredAt ? Date.now() - call.answeredAt.getTime() : 0;
      const remainingMs = config.calls.join_confirmation_timeout_ms - elapsed;
      if (remainingMs > 0 && call.handledBy) {
        logger.info(`[Call] Re-registering join timeout for ${call._id} (${remainingMs}ms remaining)`);
        startJoinTimeout(
          call._id.toString(),
          call.startedBy.toString(),
          call.station.toString(),
          call.handledBy.toString(),
          remainingMs,
        );
        answeredRegistered++;
      }
    }

    if (queuedRegistered + answeredRegistered > 0) {
      logger.info(`[Call] Re-registered timeouts: ${queuedRegistered} queued, ${answeredRegistered} answered`);
    }
  } catch (err) {
    logger.error("[Call] Re-register timeouts error:", err);
  }
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
  getOperatorOnCallId,
  getConnectedOperatorCount,
  getAvailableOperatorCount,

  // Call lifecycle
  requestCall,
  acceptCall,
  joinCall,
  endCall,
  cancelCall,
  rejectCall,

  // System-initiated endings (socket grace expiry, show end)
  endCallBySystem,
  endAllActiveCallsForStation,

  // Timeouts (exposed for socket disconnect cleanup)
  clearJoinTimeout,
  clearQueueTimeout,

  // Shared helpers (exposed for socket handlers)
  refundIfQueued,
  createStatementIfNeeded,
  emitCallEnded,

  // Startup
  cleanupStaleCalls,
  reregisterTimeouts,

  // Queries
  getCallHistory,
  getStationCalls,

  // Token generation (exposed for socket handlers)
  generateAgoraToken,
};
