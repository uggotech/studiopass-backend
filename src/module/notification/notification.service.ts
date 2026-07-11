import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { NotificationRepository } from "./notification.repository";

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

export const NotificationService = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
