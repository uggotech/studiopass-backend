import { Schema, model } from "mongoose";

import { TFollow } from "./follow.interface";

const followSchema = new Schema<TFollow>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    broadcast: { type: Schema.Types.ObjectId, ref: "Broadcast", required: true },
    notificationsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

followSchema.index({ user: 1, broadcast: 1 }, { unique: true });
followSchema.index({ broadcast: 1, createdAt: -1 });

export const Follow = model<TFollow>("Follow", followSchema);