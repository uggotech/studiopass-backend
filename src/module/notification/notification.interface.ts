import { Types } from "mongoose";

export type NotificationType =
  | "broadcast_announcement"
  | "broadcast_live"
  | "broadcast_update"
  | "system";

export type NotificationDeliveryStatus = "pending" | "sent" | "failed";

export type NotificationPlatform = "ios" | "android" | "web" | "unknown";

export interface TNotification {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  broadcast?: Types.ObjectId;
  title: string;
  body: string;
  type: NotificationType;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt?: Date | null;
  deliveryStatus: NotificationDeliveryStatus;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TNotificationToken {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  token: string;
  platform: NotificationPlatform;
  isActive: boolean;
  lastSeenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}