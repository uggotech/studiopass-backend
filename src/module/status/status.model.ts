import { model, Schema } from "mongoose";
import { TStatus } from "./status.interface";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const statusTopFanSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    creditsUsed: { type: Number, required: true, min: 0 },
    rank: { type: Number, required: true, min: 1, max: 5 },
  },
  { _id: false },
);

// ─── Schema ──────────────────────────────────────────────────────────────────

const statusSchema = new Schema<TStatus>(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["manual", "auto_weekly_top_fans"], required: true },
    content: { type: String, required: true, trim: true },
    media: { type: String },
    topFans: { type: [statusTopFanSchema], default: undefined },
    weekStart: { type: Date },
    weekEnd: { type: Date },
    expiresAt: { type: Date, required: true },
    viewCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

statusSchema.index({ station: 1, expiresAt: 1 });
statusSchema.index({ station: 1, type: 1, createdAt: -1 });
statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup

// ─── Model ───────────────────────────────────────────────────────────────────

export const Status = model<TStatus>("Status", statusSchema);
