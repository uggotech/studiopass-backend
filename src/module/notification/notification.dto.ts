import { z } from "zod";

const getNotifications = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    type: z.enum(["announcement", "reply", "system"]).optional(),
    isRead: z.enum(["true", "false"]).optional(),
  }),
});

const markAsRead = z.object({
  params: z.object({
    id: z.string().min(1, "Notification ID is required"),
  }),
});

const deleteNotification = z.object({
  params: z.object({
    id: z.string().min(1, "Notification ID is required"),
  }),
});

export const NotificationDto = {
  getNotifications,
  markAsRead,
  deleteNotification,
};
