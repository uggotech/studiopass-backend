import { Schema, model } from "mongoose";

import { TBroadcast } from "./broadcast.interface";

const socialLinksSchema = new Schema(
  {
    facebook: { type: String, trim: true },
    instagram: { type: String, trim: true },
  },
  { _id: false },
);

const broadcastSchema = new Schema<TBroadcast>(
  {
    name: { type: String, trim: true, required: true },
    type: {
      type: String,
      enum: ["tv", "radio", "channel"],
      required: true,
    },
    description: { type: String, trim: true },
    country: { type: String, trim: true, required: true },
    mottoLine: { type: String, trim: true },
    logo: { type: String, trim: true },
    coverImage: { type: String, trim: true },
    streamUrl: { type: String, trim: true, required: true },
    category: { type: [String], default: [] },
    website: { type: String, trim: true },
    socialLinks: { type: socialLinksSchema, default: undefined },
    isLive: { type: Boolean, default: false },
    liveTitle: { type: String, trim: true },
    followersCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "Auth" },
    lastNotificationAt: { type: Date, default: null },
  },
  { timestamps: true },
);

broadcastSchema.index({ name: 1 });
broadcastSchema.index({ country: 1, type: 1, isActive: 1, isLive: 1 });
broadcastSchema.index({ followersCount: -1 });

export const Broadcast = model<TBroadcast>("Broadcast", broadcastSchema);