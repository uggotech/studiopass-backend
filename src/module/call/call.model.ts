/**
 * call.model.ts
 *
 * Mongoose model and interface for the Call entity.
 *
 * Represents phone calls between listeners and station presenters.
 * Integrates with Agora for WebRTC-based calling (planned but not yet implemented).
 *
 * Business rules:
 * - Only answered/rejected calls cost credits
 * - Missed calls are free (no credits deducted)
 * - Duration is only tracked for answered calls
 * - Agora channel ID is required for all calls
 * - Credit transaction is linked for billing audit trail
 */

import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * ICall interface.
 */
export interface ICall extends Document {
  _id: mongoose.Types.ObjectId;
  id?: string;

  /** The station this call belongs to */
  station: mongoose.Types.ObjectId;

  /** The show during which the call was placed (optional) */
  show?: mongoose.Types.ObjectId;

  /** The user who initiated the call */
  startedBy: mongoose.Types.ObjectId;

  /** The user who handled/answered the call (presenter) */
  handledBy?: mongoose.Types.ObjectId;

  /** Agora channel ID for WebRTC connection */
  agoraChannelId: string;

  /** Agora resource ID (set after call ends, used for billing) */
  agoraResourceId?: string;

  /** Call duration in seconds (only set for answered calls) */
  duration?: number;

  /** When the call was initiated */
  startedAt: Date;

  /** When the call was answered (only for answered calls) */
  answeredAt?: Date;

  /** When the call ended */
  endedAt?: Date;

  /** Final status of the call */
  status: "missed" | "rejected" | "answered";

  /** Credits consumed (only for answered/rejected calls) */
  creditsUsed: number;

  /** Link to the credit transaction record */
  creditTransaction?: mongoose.Types.ObjectId;

  /** Caller's country */
  country: mongoose.Types.ObjectId;

  /** Mobile operator identifier */
  operator?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

const callSchema = new Schema<ICall>(
  {
    station: {
      type: Schema.Types.ObjectId,
      ref: "Station",
      required: [true, "Station is required"],
      index: true,
    },
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
      // Optional: not all calls happen during a scheduled show
    },
    startedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "startedBy is required"],
    },
    handledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      // Only set when call is answered or rejected
    },
    agoraChannelId: {
      type: String,
      required: [true, "Agora channel ID is required"],
      index: true,
    },
    agoraResourceId: {
      type: String,
      // Set after call ends for billing purposes
    },
    duration: {
      type: Number,
      min: [0, "Duration cannot be negative"],
      // Only populated for answered calls
    },
    startedAt: {
      type: Date,
      required: [true, "startedAt is required"],
      default: Date.now,
    },
    answeredAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["missed", "rejected", "answered"],
      required: [true, "Status is required"],
      index: true,
    },
    creditsUsed: {
      type: Number,
      required: [true, "creditsUsed is required"],
      min: [0, "Credits used cannot be negative"],
      default: 0,
    },
    creditTransaction: {
      type: Schema.Types.ObjectId,
      ref: "CreditTransaction",
      // Only set when credits are actually deducted
    },
    country: {
      type: Schema.Types.ObjectId,
      ref: "Country",
      required: [true, "Country is required"],
    },
    operator: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common query patterns
callSchema.index({ station: 1, status: 1, startedAt: -1 }); // Call history by status
callSchema.index({ station: 1, show: 1, startedAt: -1 }); // Show-specific calls
callSchema.index({ startedBy: 1, startedAt: -1 }); // User's call history
callSchema.index({ status: 1, startedAt: -1 }); // Global call queue

const Call: Model<ICall> =
  mongoose.models.Call || mongoose.model<ICall>("Call", callSchema);

export default Call;
