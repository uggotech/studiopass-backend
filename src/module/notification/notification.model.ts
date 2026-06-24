import { model, Schema } from "mongoose";
import { TNotification } from "./notification.interface";

const notificationSchema = new Schema<TNotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["announcement", "reply", "system"], required: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    data: { type: Schema.Types.Mixed, default: () => ({}) },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    deliveryStatus: { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
    errorMessage: { type: String },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, type: 1, createdAt: -1 });
notificationSchema.index({ deliveryStatus: 1 });

export const Notification = model<TNotification>("Notification", notificationSchema);