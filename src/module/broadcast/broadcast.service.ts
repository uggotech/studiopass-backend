import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "errors/AppError";
import unlinkFile from "@shared/unlinkFile";
import { BroadcastCacheManager } from "./broadcast.cacheManage";
import { BroadcastRepository } from "./broadcast.repository";
import { FollowRepository } from "module/follow/follow.repository";
import { NotificationService } from "module/notification/notification.service";

// ─── Payload Types ───────────────────────────────────────────────────────────

type TCreateBroadcastPayload = {
  name: string;
  type: "tv" | "radio" | "channel";
  description?: string;
  country: string;
  mottoLine?: string;
  logo?: string;
  coverImage?: string;
  streamUrl: string;
  category?: string[];
  website?: string;
  socialLinks?: {
    facebook?: string;
    instagram?: string;
  };
  isLive?: boolean;
  liveTitle?: string;
  isActive?: boolean;
  isVerified?: boolean;
};

type TBroadcastQuery = Record<string, unknown>;

type TSendBroadcastNotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

const parseBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
};

const escapeSearch = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizePage = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeLimit = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 100);
};

const buildBroadcastFilter = (query: TBroadcastQuery) => {
  const filter: Record<string, unknown> = {};

  if (typeof query.searchTerm === "string" && query.searchTerm.trim()) {
    const search = escapeSearch(query.searchTerm.trim());
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { country: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { mottoLine: { $regex: search, $options: "i" } },
    ];
  }

  if (typeof query.country === "string" && query.country.trim()) {
    filter.country = query.country.trim();
  }

  if (typeof query.type === "string" && query.type.trim()) {
    if(query.type.trim() === "radios") {
      filter.type = "radio";
    } else {
      filter.type = query.type.trim();
    }
  }

  const isLive = parseBoolean(query.isLive);
  if (typeof isLive === "boolean") {
    filter.isLive = isLive;
  }

  const isActive = parseBoolean(query.isActive);
  if (typeof isActive === "boolean") {
    filter.isActive = isActive;
  }

  const isVerified = parseBoolean(query.isVerified);
  if (typeof isVerified === "boolean") {
    filter.isVerified = isVerified;
  }

  return filter;
};

const buildBroadcastListCacheKey = (query: TBroadcastQuery, page: number, limit: number) => {
  return [
    page,
    limit,
    typeof query.searchTerm === "string" ? query.searchTerm.trim() : "all",
    typeof query.country === "string" ? query.country.trim() : "all",
    typeof query.type === "string" ? query.type.trim() : "all",
    typeof query.isLive === "string" || typeof query.isLive === "boolean"
      ? String(query.isLive)
      : "all",
    typeof query.isActive === "string" || typeof query.isActive === "boolean"
      ? String(query.isActive)
      : "all",
    typeof query.isVerified === "string" || typeof query.isVerified === "boolean"
      ? String(query.isVerified)
      : "all",
  ].join(":");
};

const getBroadcastById = async (broadcastId: string) => {
  if (!Types.ObjectId.isValid(broadcastId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid broadcast ID");
  }

  const cachedBroadcast = await BroadcastCacheManager.getById(broadcastId);
  if (cachedBroadcast) {
    return cachedBroadcast;
  }

  const broadcast = await BroadcastRepository.findById(broadcastId).lean();

  if (!broadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  await BroadcastCacheManager.setById(broadcastId, broadcast as unknown as Record<string, unknown>);
  return broadcast;
};

const attachFollowState = async (broadcast: Record<string, unknown>, userId?: Types.ObjectId) => {
  if (!userId) {
    return broadcast;
  }

  const follow = await FollowRepository.findOne({
    user: userId,
    broadcast: broadcast._id as Types.ObjectId,
  }).select("notificationsEnabled");

  return {
    ...broadcast,
    isFollowing: Boolean(follow),
    notificationsEnabled: follow?.notificationsEnabled ?? false,
  };
};

// ─── Broadcast Management ──────────────────────────────────────────────────────

const createBroadcast = async (payload: TCreateBroadcastPayload, actorId?: Types.ObjectId) => {
  const broadcast = await BroadcastRepository.create({
    ...payload,
    category: payload.category ?? [],
    followersCount: 0,
    isLive: payload.isLive ?? false,
    isActive: payload.isActive ?? true,
    isVerified: payload.isVerified ?? false,
    createdBy: actorId,
  });

  await BroadcastCacheManager.invalidateAll();
  return { broadcast: broadcast.toObject() };
};

const listBroadcasts = async (query: TBroadcastQuery) => {
  const page = normalizePage(query.page, 1);
  const limit = normalizeLimit(query.limit, 20);
  const skip = (page - 1) * limit;
  const filter = buildBroadcastFilter(query);
  const cacheKey = buildBroadcastListCacheKey(query, page, limit);

  const cachedList = await BroadcastCacheManager.getList(cacheKey);
  if (cachedList) {
    return cachedList;
  }

  const [items, total] = await Promise.all([
    BroadcastRepository.findMany(filter, {
      sort: { createdAt: -1 },
      skip,
      limit,
    }).lean(),
    BroadcastRepository.count(filter),
  ]);

  const result = {
    items: items as unknown as Record<string, unknown>[],
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };

  await BroadcastCacheManager.setList(cacheKey, result);
  return result;
};

const getBroadcast = async (broadcastId: string, userId?: Types.ObjectId) => {
  const broadcast = (await getBroadcastById(broadcastId)) as Record<string, unknown>;
  return attachFollowState(broadcast, userId);
};

const updateBroadcast = async (broadcastId: string, payload: Partial<TCreateBroadcastPayload>) => {
  if (!Types.ObjectId.isValid(broadcastId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid broadcast ID");
  }

  // Get current broadcast to handle image URL updates
  const currentBroadcast = await BroadcastRepository.findById(broadcastId);

  if (!currentBroadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  // Handle logo URL updates - delete old local image if new URL is provided
  if (payload.logo && currentBroadcast.logo && currentBroadcast.logo.startsWith("images/")) {
    await unlinkFile(currentBroadcast.logo);
  }

  // Handle coverImage URL updates - delete old local image if new URL is provided
  if (
    payload.coverImage &&
    currentBroadcast.coverImage &&
    currentBroadcast.coverImage.startsWith("images/")
  ) {
    await unlinkFile(currentBroadcast.coverImage);
  }

  const updatedBroadcast = await BroadcastRepository.updateById(broadcastId, {
    ...payload,
    category: payload.category ?? undefined,
  });

  if (!updatedBroadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  await BroadcastCacheManager.invalidateById(broadcastId);
  await BroadcastCacheManager.invalidateLists();
  await BroadcastCacheManager.setById(
    broadcastId,
    updatedBroadcast.toObject() as unknown as Record<string, unknown>,
  );

  return { broadcast: updatedBroadcast.toObject() };
};

const deleteBroadcast = async (broadcastId: string) => {
  const deletedBroadcast = await BroadcastRepository.deleteById(broadcastId);

  if (!deletedBroadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  await BroadcastCacheManager.invalidateById(broadcastId);
  await BroadcastCacheManager.invalidateLists();
  return { message: "Broadcast deleted successfully" };
};

const sendBroadcastNotification = async (
  broadcastId: string,
  payload: TSendBroadcastNotificationPayload,
) => {
  const broadcast = await BroadcastRepository.findById(broadcastId).lean();

  if (!broadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  const result = await NotificationService.notifyBroadcastFollowers(broadcast, payload);

  await BroadcastRepository.updateById(broadcastId, {
    lastNotificationAt: new Date(),
  });

  await BroadcastCacheManager.invalidateById(broadcastId);

  return {
    message: "Notification sent successfully",
    data: result,
  };
};

// ─── Upload Broadcast Images ────────────────────────────────────────────────────────
// Handle logo and cover image uploads (local files and URL-based images).
// Supports file uploads from multer or URL strings in request body.

type TUploadBroadcastImagesPayload = {
  logo?: string; // File path or URL
  coverImage?: string; // File path or URL
};

const uploadBroadcastImages = async (
  broadcastId: string,
  payload: TUploadBroadcastImagesPayload,
) => {
  if (!Types.ObjectId.isValid(broadcastId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid broadcast ID");
  }

  // Get current broadcast to check for existing images
  const broadcast = await BroadcastRepository.findById(broadcastId);

  if (!broadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  // Delete old images if new ones are being uploaded
  const updateData: Record<string, string | undefined> = {};

  if (payload.logo) {
    // If old logo exists and it's a local file (starts with 'images/'), delete it
    if (broadcast.logo && broadcast.logo.startsWith("images/")) {
      await unlinkFile(broadcast.logo);
    }
    updateData.logo = payload.logo;
  }

  if (payload.coverImage) {
    // If old cover image exists and it's a local file (starts with 'images/'), delete it
    if (broadcast.coverImage && broadcast.coverImage.startsWith("images/")) {
      await unlinkFile(broadcast.coverImage);
    }
    updateData.coverImage = payload.coverImage;
  }

  // Update broadcast with new image paths
  const updatedBroadcast = await BroadcastRepository.updateById(broadcastId, updateData);

  if (!updatedBroadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  // Invalidate cache
  await BroadcastCacheManager.invalidateById(broadcastId);
  await BroadcastCacheManager.invalidateLists();
  await BroadcastCacheManager.setById(
    broadcastId,
    updatedBroadcast.toObject() as unknown as Record<string, unknown>,
  );

  return { broadcast: updatedBroadcast.toObject() };
};

export const BroadcastService = {
  createBroadcast,
  listBroadcasts,
  getBroadcast,
  updateBroadcast,
  deleteBroadcast,
  sendBroadcastNotification,
  uploadBroadcastImages,
};