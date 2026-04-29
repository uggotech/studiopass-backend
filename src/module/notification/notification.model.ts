import { Schema, model } from "mongoose";

import { TNotification, TNotificationToken } from "./notification.interface";

const notificationSchema = new Schema<TNotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    broadcast: { type: Schema.Types.ObjectId, ref: "Broadcast" },
    title: { type: String, trim: true, required: true },
    body: { type: String, trim: true, required: true },
    type: {
      type: String,
      enum: ["broadcast_announcement", "broadcast_live", "broadcast_update", "system"],
      default: "broadcast_announcement",
    },
    data: { type: Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    deliveryStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    errorMessage: { type: String, trim: true },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ broadcast: 1, createdAt: -1 });

const notificationTokenSchema = new Schema<TNotificationToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, trim: true, required: true, unique: true },
    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },
    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationTokenSchema.index({ user: 1, isActive: 1 });

export const Notification = model<TNotification>("Notification", notificationSchema);
export const NotificationToken = model<TNotificationToken>("NotificationToken", notificationTokenSchema);