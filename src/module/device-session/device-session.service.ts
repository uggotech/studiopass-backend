import crypto from "crypto";
import { DeviceSession } from "./device-session.model";
import { RegisterSessionInput } from "./device-session.interface";
import redisClient from "../../redis/redisClient";
import { emitToUser } from "../../socket";
import AppError from "../../errors/AppError";
import { StatusCodes } from "http-status-codes";
import { logger } from "../../logger/logger";
import { AuditLogService } from "../auditLog/auditLog.service";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function parseUserAgent(ua?: string): { browser: string; os: string } {
  if (!ua) return { browser: "Unknown Browser", os: "Unknown OS" };

  let browser = "Unknown Browser";
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/opera|opr/i.test(ua)) browser = "Opera";

  let os = "Unknown OS";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os/i.test(ua)) os = "macOS";
  else if (/ipad|iphone|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  return { browser, os };
}

const registerSession = async (input: RegisterSessionInput) => {
  const sessionId = crypto.randomUUID();
  const deviceId = input.deviceId || crypto.randomUUID();

  const { browser, os } = parseUserAgent(input.userAgent);
  const deviceName = input.deviceName || `${os} Terminal (${browser})`;

  // Check if this deviceId has previously been approved as a studio device for this user or station
  let isApprovedStudioDevice = false;
  const existingApproved = await DeviceSession.findOne({
    deviceId,
    $or: [
      { userId: input.userId },
      ...(input.stationId ? [{ stationId: input.stationId }] : []),
    ],
    isApprovedStudioDevice: true,
  });

  if (existingApproved) {
    isApprovedStudioDevice = true;
  }

  const session = await DeviceSession.create({
    userId: input.userId,
    authId: input.authId,
    stationId: input.stationId,
    sessionId,
    deviceId,
    deviceName,
    browser,
    os,
    ipAddress: input.ipAddress || "Unknown IP",
    isApprovedStudioDevice,
    status: "active",
    lastActiveAt: new Date(),
  });

  // Store active session marker in Redis
  try {
    await redisClient.set(`session:active:${sessionId}`, "1", SESSION_TTL_SECONDS);
    // Absolute session lifetime (survives refresh rotation until hard re-auth)
    const absoluteDays = Number(process.env.SESSION_ABSOLUTE_MAX_DAYS || 30);
    await redisClient.set(
      `session:started:${sessionId}`,
      String(Date.now()),
      absoluteDays * 24 * 60 * 60,
    );
  } catch (err: any) {
    logger.warn(`[DeviceSession] Failed to cache active session in Redis: ${err?.message}`);
  }

  return {
    sessionId,
    deviceId,
    isApprovedStudioDevice: session.isApprovedStudioDevice,
  };
};

const getUserSessions = async (userId: string) => {
  const sessions = await DeviceSession.find({ userId })
    .sort({ lastActiveAt: -1 })
    .lean();

  return sessions;
};

const revokeSession = async (sessionId: string) => {
  const session = await DeviceSession.findOne({ sessionId });
  if (!session) {
    throw new AppError(StatusCodes.NOT_FOUND, "Session not found");
  }

  session.status = "revoked";
  await session.save();

  // Remove from Redis active sessions
  try {
    await redisClient.del(`session:active:${sessionId}`);
    await redisClient.del(`session:started:${sessionId}`);
    // Drop cached auth status so deactivated users fail fast on next login path
    const authKey = session.authId ? `auth:status:${session.authId.toString()}` : null;
    if (authKey) await redisClient.del(authKey);
  } catch (err: any) {
    logger.warn(`[DeviceSession] Failed to delete session from Redis: ${err?.message}`);
  }

  // Real-time notification to kick the device immediately
  try {
    emitToUser(session.userId.toString(), "force-logout", {
      sessionId,
      reason: "This device session was terminated remotely by an administrator.",
    });
  } catch (err: any) {
    logger.warn(`[DeviceSession] Failed to emit force-logout event: ${err?.message}`);
  }

  await AuditLogService.logAuthEvent({
    action: "SESSION_REVOKED",
    status: "SUCCESS",
    userId: session.userId as any,
    authId: session.authId as any,
    metadata: { sessionId, method: "ADMIN_REVOKE", deviceId: session.deviceId },
  });

  return session;
};

const revokeAllUserSessions = async (userId: string) => {
  const activeSessions = await DeviceSession.find({ userId, status: "active" });

  for (const session of activeSessions) {
    try {
      await redisClient.del(`session:active:${session.sessionId}`);
    } catch {}
  }

  await DeviceSession.updateMany(
    { userId, status: "active" },
    { $set: { status: "revoked" } }
  );

  // Real-time notification to kick all devices for this user
  try {
    emitToUser(userId, "force-logout", {
      reason: "All active sessions for your account were terminated remotely.",
    });
  } catch (err: any) {
    logger.warn(`[DeviceSession] Failed to emit force-logout event: ${err?.message}`);
  }

  return { revokedCount: activeSessions.length };
};

const toggleDeviceApproval = async (
  sessionId: string,
  isApproved: boolean,
  adminUserId?: string
) => {
  const session = await DeviceSession.findOne({ sessionId });
  if (!session) {
    throw new AppError(StatusCodes.NOT_FOUND, "Session not found");
  }

  const updateFields: Record<string, any> = {
    isApprovedStudioDevice: isApproved,
    approvedAt: isApproved ? new Date() : null,
    approvedBy: isApproved && adminUserId ? adminUserId : null,
  };

  // Update this session and any other sessions belonging to this same deviceId
  await DeviceSession.updateMany(
    { deviceId: session.deviceId, userId: session.userId },
    { $set: updateFields }
  );

  session.isApprovedStudioDevice = isApproved;
  if (isApproved) {
    session.approvedAt = new Date();
    if (adminUserId) session.approvedBy = adminUserId as any;
  } else {
    session.approvedAt = undefined;
    session.approvedBy = undefined;
  }
  await session.save();

  return session;
};

/** Revoke the caller's own current session (manual logout). */
const logoutOwnSession = async (sessionId: string, userId: string) => {
  const session = await DeviceSession.findOne({ sessionId, userId });
  if (!session) {
    // Still clear Redis markers even if DB row is missing
    try {
      await redisClient.del(`session:active:${sessionId}`);
      await redisClient.del(`session:started:${sessionId}`);
    } catch {}
    return { sessionId, status: "revoked" as const };
  }

  session.status = "revoked";
  await session.save();

  try {
    await redisClient.del(`session:active:${sessionId}`);
    await redisClient.del(`session:started:${sessionId}`);
  } catch (err: any) {
    logger.warn(`[DeviceSession] Failed to delete session from Redis on logout: ${err?.message}`);
  }

  await AuditLogService.logAuthEvent({
    action: "SESSION_REVOKED",
    status: "SUCCESS",
    userId: session?.userId ? (session.userId as any) : undefined,
    authId: session?.authId ? (session.authId as any) : undefined,
    metadata: { sessionId, method: "LOGOUT", deviceId: session?.deviceId },
  });

  return session;
};

export const DeviceSessionService = {
  registerSession,
  getUserSessions,
  revokeSession,
  revokeAllUserSessions,
  toggleDeviceApproval,
  logoutOwnSession,
};
