import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import config from "../../config";
import { StationApiKeyRepository } from "./stationApiKey.repository";
import { StationApiKeyLogRepository } from "../stationApiKeyLog/stationApiKeyLog.repository";
import { StationApiKeyLog } from "../stationApiKeyLog/stationApiKeyLog.model";
import { StationRepository } from "../station/station.repository";
import { AuthRepository } from "../auth/auth.repository";
import Message from "../message/message.model";

const generateApiKey = (): string => {
  return `sp_${crypto.randomBytes(32).toString("hex")}`;
};

const getKeysByStation = async (stationId: string, callerRole: string, callerStationId?: string) => {
  // Authorization: station_admin can only see their own station's keys
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only view keys for your own station.");
  }

  const keys = await StationApiKeyRepository.findByStation(stationId);
  return keys;
};

const createKey = async (
  stationId: string,
  name: string,
  type: "sandbox" | "production",
  callerRole: string,
  callerStationId?: string,
) => {
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only create keys for your own station.");
  }

  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const key = generateApiKey();

  const created = await StationApiKeyRepository.create({
    station: new mongoose.Types.ObjectId(stationId),
    key,
    name,
    type,
    isActive: true,
    totalHits: 0,
    avgResponseTimeMs: 0,
  });

  // Return the key only on creation (it won't be shown again)
  return { ...created, key };
};

const regenerateKey = async (
  keyId: string,
  stationId: string,
  callerRole: string,
  callerStationId?: string,
) => {
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only regenerate keys for your own station.");
  }

  const oldKey = await StationApiKeyRepository.findById(keyId);
  if (!oldKey) {
    throw new AppError(StatusCodes.NOT_FOUND, "API key not found");
  }
  if ((oldKey as any).station?.toString() !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "API key does not belong to this station.");
  }

  // Deactivate old key
  await StationApiKeyRepository.deactivate(keyId, stationId);

  // Create new key linked to old one
  const newKey = generateApiKey();
  const created = await StationApiKeyRepository.create({
    station: new mongoose.Types.ObjectId(stationId),
    key: newKey,
    name: (oldKey as any).name,
    type: (oldKey as any).type,
    isActive: true,
    regeneratedAt: new Date(),
    regeneratedFrom: oldKey._id,
    totalHits: 0,
    avgResponseTimeMs: 0,
  });

  return { ...created, key: newKey };
};

const deactivateKey = async (
  keyId: string,
  stationId: string,
  callerRole: string,
  callerStationId?: string,
) => {
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only deactivate keys for your own station.");
  }

  const key = await StationApiKeyRepository.findById(keyId);
  if (!key) {
    throw new AppError(StatusCodes.NOT_FOUND, "API key not found");
  }
  if ((key as any).station?.toString() !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "API key does not belong to this station.");
  }

  await StationApiKeyRepository.deactivate(keyId, stationId);
  return { success: true };
};

/**
 * External API: Get messages for TV output using API key authentication.
 * This is the endpoint that TV displays poll for approved messages.
 */
const getMessagesForOutput = async (
  apiKey: string,
  options: { limit?: number; show?: string; before?: string },
  ipAddress?: string,
) => {
  const startTime = Date.now();

  const keyDoc = await StationApiKeyRepository.findByKey(apiKey);
  if (!keyDoc) {
    // Log failed attempt
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid or inactive API key.");
  }

  const stationId = (keyDoc as any).station?.toString();
  const limit = Math.min(options.limit || 20, 100);

  const filter: Record<string, unknown> = {
    station: stationId,
    senderType: "user",
    status: "sent_to_output",
  };

  if (options.show) {
    // Look up show by name for this station
    const { Show } = await import("../show/show.model");
    const show = await Show.findOne({
      station: stationId,
      name: { $regex: new RegExp(`^${options.show.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).lean();
    if (show) {
      filter.show = show._id;
    }
  }

  if (options.before) {
    filter.createdAt = { $lt: new Date(options.before) };
  }

  const messages = await Message.find(filter)
    .select("content msisdn show user sentToOutputAt createdAt")
    .populate("show", "name")
    .populate("user", "fullName avatar")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const responseTimeMs = Date.now() - startTime;

  // Update denormalized stats (non-blocking)
  StationApiKeyRepository.incrementHits(keyDoc._id.toString(), responseTimeMs).catch(() => {});

  // Mask msisdn for TV output (TV should not show full phone numbers)
  const minioBaseUrl = config.minio.publicUrl
    || `${config.minio.useSSL ? "https" : "http"}://${config.minio.endpoint}:${config.minio.port}`;
  const maskedMessages = messages.map((m) => ({
    id: m._id,
    content: m.content,
    msisdn: m.msisdn ? `${m.msisdn.substring(0, 4)}****${m.msisdn.substring(m.msisdn.length - 3)}` : "",
    show: (m.show as any)?.name || "",
    user: (m as any).user
      ? {
          name: (m as any).user.fullName || null,
          avatar: (m as any).user.avatar ? `${minioBaseUrl}/${(m as any).user.avatar}` : null,
        }
      : null,
    sentToOutputAt: m.sentToOutputAt,
    createdAt: m.createdAt,
  }));

  const responseSizeBytes = JSON.stringify(maskedMessages).length;

  // Log the API hit (non-blocking)
  const endpoint = "/api/v1/station-api/messages";
  const queryParams = { limit, show: options.show, before: options.before };
  StationApiKeyLogRepository.create({
    apiKey: keyDoc._id.toString(),
    station: stationId,
    endpoint,
    queryParams,
    responseTimeMs,
    statusCode: 200,
    ipAddress,
    responseSizeBytes,
  }).catch(() => {}); // non-blocking

  return { messages: maskedMessages };
};

const getStationStats = async (stationId: string, callerRole: string, callerStationId?: string) => {
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only view stats for your own station.");
  }

  const keys = await StationApiKeyRepository.findByStation(stationId);

  // Aggregate from logs
  const [statusAgg, totalAgg] = await Promise.all([
    StationApiKeyLog.aggregate([
      { $match: { station: new mongoose.Types.ObjectId(stationId) } },
      { $group: { _id: "$statusCode", count: { $sum: 1 } } },
    ]),
    StationApiKeyLog.aggregate([
      { $match: { station: new mongoose.Types.ObjectId(stationId) } },
      { $group: { _id: null, total: { $sum: 1 }, avgMs: { $avg: "$responseTimeMs" } } },
    ]),
  ]);

  const total = totalAgg[0]?.total || 0;
  const avgResponseTimeMs = Math.round(totalAgg[0]?.avgMs || 0);
  const successCount = statusAgg.find((s: any) => s._id === 200)?.count || 0;
  const successRatio = total > 0 ? Math.round((successCount / total) * 1000) / 1000 : 1;

  // Today's hits
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayAgg = await StationApiKeyLog.aggregate([
    { $match: { station: new mongoose.Types.ObjectId(stationId), hitAt: { $gte: todayStart } } },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);
  const hitsToday = todayAgg[0]?.count || 0;

  // Status code breakdown
  const recentStatusCodes: Record<string, number> = {};
  statusAgg.forEach((s: any) => { recentStatusCodes[s._id] = s.count; });

  // Top keys by hits
  const topKeys = keys.map((k: any) => ({
    id: k._id,
    name: k.name,
    type: k.type,
    hits: k.totalHits,
    avgMs: k.avgResponseTimeMs,
    isActive: k.isActive,
  })).sort((a: any, b: any) => b.hits - a.hits);

  return {
    totalHits: total,
    avgResponseTimeMs,
    successRatio,
    hitsToday,
    recentStatusCodes,
    topKeys,
  };
};

const revealKey = async (
  keyId: string,
  stationId: string,
  password: string,
  callerRole: string,
  callerStationId?: string,
  callerAuthId?: string,
) => {
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only reveal keys for your own station.");
  }

  const key = await StationApiKeyRepository.findById(keyId);
  if (!key) {
    throw new AppError(StatusCodes.NOT_FOUND, "API key not found");
  }
  if ((key as any).station?.toString() !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "API key does not belong to this station.");
  }

  // Verify password against auth record
  if (!callerAuthId) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Cannot verify identity.");
  }
  const authAccount = await AuthRepository.findByIdWithPassword(callerAuthId);
  if (!authAccount || !authAccount.password) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Account not found or no password set.");
  }
  const isPasswordValid = await bcrypt.compare(password, authAccount.password);
  if (!isPasswordValid) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid password.");
  }

  return { key: (key as any).key };
};

const getStationLogs = async (
  stationId: string,
  page: number,
  limit: number,
  callerRole: string,
  callerStationId?: string,
) => {
  if (callerRole === "station_admin" && callerStationId !== stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only view logs for your own station.");
  }

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    StationApiKeyLog.find({ station: stationId })
      .sort({ hitAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StationApiKeyLog.countDocuments({ station: stationId }),
  ]);

  return {
    logs: logs.map((l: any) => ({
      id: l._id,
      endpoint: l.endpoint,
      queryParams: l.queryParams,
      responseTimeMs: l.responseTimeMs,
      statusCode: l.statusCode,
      ipAddress: l.ipAddress,
      responseSizeBytes: l.responseSizeBytes,
      hitAt: l.hitAt,
      apiKeyId: l.apiKey,
    })),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

export const StationApiKeyService = {
  getKeysByStation,
  createKey,
  regenerateKey,
  deactivateKey,
  revealKey,
  getMessagesForOutput,
  getStationStats,
  getStationLogs,
};
