import { Types } from "mongoose";

export type NotificationType = "announcement" | "reply" | "system";
export type NotificationDeliveryStatus = "pending" | "sent" | "failed";

/**
 * Notification data shapes by type:
 *
 * announcement:
 *   { stationId, announcementType?: "live" | "update" }
 *
 * reply:
 *   { stationId, messageId, showName }
 *
 * system:
 *   { action: string, [key: string]: any }
 *   Actions: "credits_granted", "account_created", "maintenance", "poll_new", etc.
 */
export interface TNotification {
  _id: Types.ObjectId;
  user: Types.ObjectId; // → User (who receives this)
  type: NotificationType;

  title: string; // "New reply from Capital FM"
  body: string; // "We received your message..."

  // Flexible payload — structure varies by type
  data: Record<string, unknown>;

  // Read tracking
  isRead: boolean;
  readAt?: Date | null;

  // Delivery tracking
  deliveryStatus: NotificationDeliveryStatus;
  errorMessage?: string;

  createdAt: Date;
  updatedAt: Date;
}



