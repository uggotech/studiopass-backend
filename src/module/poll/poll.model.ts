import { model, Schema } from "mongoose";
import { TPoll, TPollOption } from "./poll.interface";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const pollOptionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    votes: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

// ─── Schema ──────────────────────────────────────────────────────────────────

const pollSchema = new Schema<TPoll>(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    show: { type: Schema.Types.ObjectId, ref: "Show" },
    question: { type: String, required: true, trim: true },
    options: {
      type: [pollOptionSchema],
      required: true,
      validate: [(v: TPollOption[]) => v.length >= 2, "At least 2 options required"],
    },
    status: { type: String, enum: ["draft", "active", "completed"], default: "draft" },
    totalVotes: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

pollSchema.index({ station: 1, status: 1 });
pollSchema.index({ show: 1 });

// ─── Model ───────────────────────────────────────────────────────────────────

export const Poll = model<TPoll>("Poll", pollSchema);
