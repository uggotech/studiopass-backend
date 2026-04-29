import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "errors/AppError";
import { sendFirebaseMulticastNotification } from "util/firebasePushNotification";

import { FollowRepository } from "module/follow/follow.repository";

import { NotificationCacheManager } from "./notification.cacheManage";
import { NotificationRepository, NotificationTokenRepository } from "./notification.repository";
import type { NotificationPlatform, NotificationType, TNotificationToken } from "./notification.interface";
import type { TBroadcast } from "module/broadcast/broadcast.interface";

type TRegisterTokenPayload = {
  token: string;
  platform?: NotificationPlatform;
};

type TNotificationQuery = Record<string, unknown>;

type TCreateBroadcastNotificationPayload = {
  title: string;
  body: string;
  type?: NotificationType;
  data?: Record<string, unknown>;
};

const parsePage = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const parseLimit = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 100);
};

const parseBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
};

const buildNotificationListCacheKey = (
  userId: string,
  query: TNotificationQuery,
  page: number,
  limit: number,
) => {
  const readKey = typeof query.isRead === "string" || typeof query.isRead === "boolean"
    ? String(query.isRead)
    : "all";

  const searchKey = typeof query.searchTerm === "string" ? query.searchTerm.trim() : "all";

  return [userId, page, limit, readKey, searchKey].join(":");
};

const buildNotificationFilter = (userId: Types.ObjectId, query: TNotificationQuery) => {
  const filter: Record<string, unknown> = { user: userId };

  const isRead = parseBoolean(query.isRead);
  if (typeof isRead === "boolean") {
    filter.isRead = isRead;
  }

  if (typeof query.searchTerm === "string" && query.searchTerm.trim()) {
    const search = query.searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { body: { $regex: search, $options: "i" } },
    ];
  }

  return filter;
};

// ─── Status Checks ─────────────────────────────────────────────────────────────

const getUnreadCount = async (userId: Types.ObjectId) => {
  const cachedCount = await NotificationCacheManager.getUnreadCount(String(userId));
  if (typeof cachedCount === "number") {
    return cachedCount;
  }

  const count = await NotificationRepository.count({ user: userId, isRead: false });
  await NotificationCacheManager.setUnreadCount(String(userId), count);
  return count;
};

// ─── Token Management ──────────────────────────────────────────────────────────

const registerDeviceToken = async (userId: Types.ObjectId, payload: TRegisterTokenPayload) => {
  const tokenDoc = await NotificationTokenRepository.upsertByToken(payload.token, {
    user: userId,
    platform: payload.platform ?? "unknown",
    isActive: true,
    lastSeenAt: new Date(),
  });

  return { token: tokenDoc?.toObject() ?? null };
};

const removeDeviceToken = async (userId: Types.ObjectId, token: string) => {
  await NotificationTokenRepository.deleteMany({ user: userId, token });
  return { message: "Device token removed successfully" };
};

// ─── Notification Actions ──────────────────────────────────────────────────────

const listNotifications = async (userId: Types.ObjectId, query: TNotificationQuery) => {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 20);
  const skip = (page - 1) * limit;
  const cacheKey = buildNotificationListCacheKey(String(userId), query, page, limit);

  const cachedList = await NotificationCacheManager.getList(cacheKey);
  if (cachedList) {
    return cachedList;
  }

  const filter = buildNotificationFilter(userId, query);

  const [items, total] = await Promise.all([
    NotificationRepository.findMany(filter, {
      sort: { createdAt: -1 },
      skip,
      limit,
    }).lean(),
    NotificationRepository.count(filter),
  ]);

  const result = {
    items,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };

  await NotificationCacheManager.setList(cacheKey, result);
  return result;
};

const markAsRead = async (userId: Types.ObjectId, notificationId: string) => {
  if (!Types.ObjectId.isValid(notificationId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid notification ID");
  }

  const notification = await NotificationRepository.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { isRead: true, readAt: new Date() },
  );

  if (!notification) {
    throw new AppError(StatusCodes.NOT_FOUND, "Notification not found");
  }

  await NotificationCacheManager.invalidateUnreadCount(String(userId));
  await NotificationCacheManager.invalidateUserLists(String(userId));

  return { notification: notification.toObject() };
};

const markAllAsRead = async (userId: Types.ObjectId) => {
  await NotificationRepository.updateMany(
    { user: userId, isRead: false },
    { isRead: true, readAt: new Date() },
  );

  await NotificationCacheManager.invalidateUnreadCount(String(userId));
  await NotificationCacheManager.invalidateUserLists(String(userId));

  return { message: "All notifications marked as read" };
};

const removeNotification = async (userId: Types.ObjectId, notificationId: string) => {
  if (!Types.ObjectId.isValid(notificationId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid notification ID");
  }

  const notification = await NotificationRepository.deleteMany({ _id: notificationId, user: userId });
  if (!notification.deletedCount) {
    throw new AppError(StatusCodes.NOT_FOUND, "Notification not found");
  }

  await NotificationCacheManager.invalidateUnreadCount(String(userId));
  await NotificationCacheManager.invalidateUserLists(String(userId));

  return { message: "Notification deleted successfully" };
};

// ─── External Integrations ───────────────────────────────────────────────────

const notifyBroadcastFollowers = async (
  broadcast: Pick<TBroadcast, "_id" | "name" | "type">,
  payload: TCreateBroadcastNotificationPayload,
) => {
  const followers = await FollowRepository.findMany(
    { broadcast: broadcast._id, notificationsEnabled: true },
    { select: "user" },
  ).lean<{ user: Types.ObjectId }[]>();

  const userIds = [...new Set(followers.map((follow) => String(follow.user)))];

  if (!userIds.length) {
    return {
      recipients: 0,
      notifications: [],
      push: { successCount: 0, failureCount: 0 },
    };
  }

  const notificationPayload = userIds.map((userId) => ({
    user: new Types.ObjectId(userId),
    broadcast: broadcast._id,
    title: payload.title,
    body: payload.body,
    type: payload.type ?? "broadcast_announcement",
    data: {
      ...(payload.data ?? {}),
      broadcastId: String(broadcast._id),
      broadcastName: broadcast.name,
      broadcastType: broadcast.type,
    },
    deliveryStatus: "pending" as const,
  }));

  const notifications = await NotificationRepository.createMany(notificationPayload);

  const tokens = (await NotificationTokenRepository.findMany(
    { user: { $in: userIds }, isActive: true },
    { select: "token user" },
  ).lean()) as TNotificationToken[];

  const pushResult = await sendFirebaseMulticastNotification(
    tokens.map((tokenDoc) => tokenDoc.token),
    {
      title: payload.title,
      body: payload.body,
      data: {
        broadcastId: String(broadcast._id),
        broadcastName: broadcast.name,
        broadcastType: broadcast.type,
      },
    },
  );

  await NotificationRepository.updateMany(
    { _id: { $in: notifications.map((notification) => notification._id) } },
    {
      deliveryStatus: pushResult.failureCount > 0 && pushResult.successCount === 0 ? "failed" : "sent",
    },
  );

  await Promise.all(userIds.map((userId) => NotificationCacheManager.invalidateUnreadCount(userId)));

  return {
    recipients: userIds.length,
    notifications: notifications.map((notification) => notification.toObject()),
    push: pushResult,
  };
};

export const NotificationService = {
  registerDeviceToken,
  removeDeviceToken,
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  removeNotification,
  notifyBroadcastFollowers,
};