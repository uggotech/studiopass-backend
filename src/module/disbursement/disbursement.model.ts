import { Schema, model } from "mongoose";
import { TDisbursement } from "./disbursement.interface";

const disbursementSchema = new Schema<TDisbursement>(
  {
    challenge: { type: Schema.Types.ObjectId, ref: "Challenge", required: true },
    winnerUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    winnerName: { type: String, required: true, trim: true },
    // Not required: a winner without a phone must still get a (failed) row instead of aborting the run
    phone: { type: String, trim: true, default: "" },
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    prizeTypeKey: { type: String, required: true, trim: true },
    prizeLabel: { type: String, required: true, trim: true },
    prizeValue: { type: String, required: true, trim: true },
    txRef: { type: String, trim: true },
    provider: { type: String, trim: true },
    providerRequestId: { type: String, trim: true, index: true },
    // Operator receipt id once paid (e.g. airtel_money_id)
    providerReference: { type: String, trim: true },
    status: {
      type: String,
      enum: ["pending", "processing", "successful", "failed", "cancelled"],
      default: "pending",
    },
    failureReason: { type: String, trim: true },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

disbursementSchema.index({ status: 1 });
disbursementSchema.index({ winnerUser: 1 });
// One prize row per winner per challenge (also guards against double creation)
disbursementSchema.index({ challenge: 1, winnerUser: 1 }, { unique: true });
disbursementSchema.index({ station: 1, status: 1 });

export const Disbursement = model<TDisbursement>("Disbursement", disbursementSchema);
