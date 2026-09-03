import { Types } from "mongoose";

export type CreditTxType = "purchase" | "admin_grant" | "admin_deduction" | "message_deduction" | "call_deduction" | "call_refund" | "challenge_deduction" | "challenge_refund" | "poll_deduction" | "poll_refund" | "challenge_reward";
export type PaymentMethod = "mobile_money" | "card";
export type CreditTxStatus = "completed" | "pending" | "failed";

export interface TCreditTransaction {
  _id: Types.ObjectId;
  user: Types.ObjectId; // → User
  type: CreditTxType;
  amount: number; // +N for grants/purchases, -N for usage/deduction
  isFree: boolean; // true = super admin gave this (no revenue for station)

  // Balance audit trail
  previousBalance?: number;
  newBalance?: number;
  reason?: string;
  adminRole?: string;
  adminName?: string;

  // Purchase/grant/deduction metadata
  paymentMethod?: PaymentMethod;
  paymentProvider?: string; // "airtel", "mtn", "stripe"
  paymentReference?: string; // provider transaction ID
  currency?: string; // "UGX", "KES"
  localAmount?: number; // actual money amount (0 for free grants)
  country?: Types.ObjectId; // → Country
  grantedBy?: Types.ObjectId; // → User (admin who granted or deducted credits)

  // Usage metadata
  station?: Types.ObjectId; // → Station (which station this was spent at)
  resourceType?: "message" | "call" | "challenge" | "poll";
  resourceId?: Types.ObjectId; // → Message, CallLog, Challenge, or ChannelPoll

  status: CreditTxStatus;
  createdAt: Date;
  updatedAt: Date;
}
