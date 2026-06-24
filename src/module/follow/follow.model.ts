import { Schema, model } from "mongoose";
import { TFollow } from "./follow.interface";

const followSchema = new Schema<TFollow>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    notificationsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// One follow per user per station
followSchema.index({ user: 1, station: 1 }, { unique: true });
followSchema.index({ station: 1, createdAt: -1 });

export const Follow = model<TFollow>("Follow", followSchema);