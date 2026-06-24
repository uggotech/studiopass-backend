import { model, Schema } from "mongoose";
import { TCreditTransaction } from "./creditTransaction.interface";

const creditTransactionSchema = new Schema<TCreditTransaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["purchase", "admin_grant", "message_deduction", "call_deduction"], required: true },
    amount: { type: Number, required: true },
    isFree: { type: Boolean, required: true, default: false },
    paymentMethod: { type: String, enum: ["mobile_money", "card"] },
    paymentProvider: { type: String, trim: true },
    paymentReference: { type: String, trim: true },
    currency: { type: String, trim: true },
    localAmount: { type: Number, min: 0 },
    country: { type: Schema.Types.ObjectId, ref: "Country" },
    grantedBy: { type: Schema.Types.ObjectId, ref: "User" },
    station: { type: Schema.Types.ObjectId, ref: "Station" },
    resourceType: { type: String, enum: ["message", "call"] },
    resourceId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ["completed", "pending", "failed"], default: "completed" },
  },
  { timestamps: true },
);

creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ station: 1, type: 1, isFree: 1 });
creditTransactionSchema.index({ type: 1, paymentProvider: 1 });
creditTransactionSchema.index({ country: 1, type: 1 });

export const CreditTransaction = model<TCreditTransaction>("CreditTransaction", creditTransactionSchema);