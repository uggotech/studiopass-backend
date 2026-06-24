import { model, Schema } from "mongoose";
import { TStatusView } from "./status-view.interface";

// ─── Schema ──────────────────────────────────────────────────────────────────

const statusViewSchema = new Schema<TStatusView>(
  {
    status: { type: Schema.Types.ObjectId, ref: "Status", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    viewedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// Unique compound index — one view per user per status
statusViewSchema.index({ status: 1, user: 1 }, { unique: true });
statusViewSchema.index({ user: 1, viewedAt: -1 });

// ─── Model ───────────────────────────────────────────────────────────────────

export const StatusView = model<TStatusView>("StatusView", statusViewSchema);
