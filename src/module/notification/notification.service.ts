import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { NotificationRepository } from "./notification.repository";
import { Notification } from "./notification.model";
import { sendFirebaseNotification } from "../../util/firebasePushNotification";
import { emitToUser } from "../../socket";
import { User } from "../user/user.model";
import { logger } from "logger/logger";

type CreateNotificationPayload = {
  userId: string;
  type: "announcement" | "reply" | "system";
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const createNotification = async (payload: CreateNotificationPayload) => {
  const { userId, type, title, body, data = {} } = payload;

  // 1. Save to DB
  const notification = await Notification.create({
    user: userId,
    type,
    title,
    body,
    data,
    deliveryStatus: "pending",
  });

  // 2. Emit socket event (for in-app toast if user is connected & foreground)
  try {
    emitToUser(userId, "new-notification", {
      notification: {
        id: notification._id,
        type,
        title,
        body,
        data,
        isRead: false,
        createdAt: notification.createdAt,
      },
    });
  } catch {
    // socket failure should not block
  }

  // 3. Send FCM push (for background/closed app delivery)
  try {
    const user = await User.findById(userId).select("fcmToken preferences").lean();

    // Verify user notification consent / preference setting
    const isPushEnabled = (user as any)?.preferences?.notificationsEnabled !== false;

    if (user?.fcmToken && isPushEnabled) {
      const result = await sendFirebaseNotification(user.fcmToken, {
        title,
        body,
        data,
      });

      if (result.successCount > 0) {
        await Notification.findByIdAndUpdate(notification._id, { deliveryStatus: "sent" });
      } else if (result.failureCount > 0) {
        await Notification.findByIdAndUpdate(notification._id, {
          deliveryStatus: "failed",
          errorMessage: "FCM delivery failed",
        });
      }
    } else {
      logger.info(`[Notification] FCM skipped — no fcmToken or push disabled for user ${userId}`);
    }
  } catch (e) {
    logger.error("[Notification] FCM push failed", { error: e });
  }

  return notification;
};

const getNotifications = async (
  userId: string,
  query: { page?: number; limit?: number; type?: string; isRead?: string },
) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.type) filter.type = query.type;
  if (query.isRead !== undefined) filter.isRead = query.isRead === "true";

  const [notifications, total] = await Promise.all([
    NotificationRepository.findByUser(userId, filter, { skip, limit }),
    NotificationRepository.countByUser(userId, filter),
  ]);

  return {
    notifications,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getUnreadCount = async (userId: string) => {
  const count = await NotificationRepository.countByUser(userId, { isRead: false });
  return { count };
};

const markAsRead = async (id: string, userId: string) => {
  const notification = await NotificationRepository.findById(id);
  if (!notification) {
    throw new AppError(StatusCodes.NOT_FOUND, "Notification not found");
  }
  if ((notification as any).user?.toString() !== userId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only mark your own notifications as read.");
  }

  const updated = await NotificationRepository.markAsRead(id, userId);
  return updated;
};

const markAllAsRead = async (userId: string) => {
  await NotificationRepository.markAllAsRead(userId);
  return { success: true };
};

const deleteNotification = async (id: string, userId: string) => {
  const notification = await NotificationRepository.findById(id);
  if (!notification) {
    throw new AppError(StatusCodes.NOT_FOUND, "Notification not found");
  }
  if ((notification as any).user?.toString() !== userId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You can only delete your own notifications.");
  }

  await NotificationRepository.deleteById(id, userId);
  return { success: true };
};

const sendBulkNotifications = async (
  userIds: string[],
  title: string,
  body: string,
  type: "system" | "announcement" | "reply" = "system",
  data: Record<string, unknown> = {},
) => {
  const CHUNK_SIZE = 500;
  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((userId) =>
        createNotification({ userId, title, body, type, data }).catch(() => null),
      ),
    );
  }
  return { success: true, count: userIds.length };
};

export const NotificationService = {
  createNotification,
  sendBulkNotifications,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
