import { Schema, model } from "mongoose";
import { TPaymentTransaction } from "./payment.interface";

const paymentTransactionSchema = new Schema<TPaymentTransaction>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["payleo", "airtel"],
      required: true,
      index: true,
    },
    carrier: {
      type: String,
      enum: ["MTN", "AIRTEL"],
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "UGX",
    },
    creditsToGrant: {
      type: Number,
      required: true,
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    referenceId: {
      type: String,
    },
    providerReference: {
      type: String,
    },
    narration: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "cancelled"],
      default: "pending",
      index: true,
    },
    rawRequest: {
      type: Schema.Types.Mixed,
    },
    rawCallback: {
      type: Schema.Types.Mixed,
    },
    failureReason: {
      type: String,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

paymentTransactionSchema.index({ user: 1, createdAt: -1 });
paymentTransactionSchema.index({ provider: 1, status: 1 });

export const PaymentTransaction = model<TPaymentTransaction>(
  "PaymentTransaction",
  paymentTransactionSchema,
);
