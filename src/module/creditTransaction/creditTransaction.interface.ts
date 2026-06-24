import { Types } from "mongoose";

export type CreditTxType = "purchase" | "admin_grant" | "message_deduction" | "call_deduction";
export type PaymentMethod = "mobile_money" | "card";
export type CreditTxStatus = "completed" | "pending" | "failed";

export interface TCreditTransaction {
  _id: Types.ObjectId;
  user: Types.ObjectId; // → User
  type: CreditTxType;
  amount: number; // +N for grants/purchases, -N for usage
  isFree: boolean; // true = super admin gave this (no revenue for station)

  // Purchase/grant metadata
  paymentMethod?: PaymentMethod;
  paymentProvider?: string; // "airtel", "mtn", "stripe"
  paymentReference?: string; // provider transaction ID
  currency?: string; // "UGX", "KES"
  localAmount?: number; // actual money amount (0 for free grants)
  country?: Types.ObjectId; // → Country

  // Usage metadata
  station?: Types.ObjectId; // → Station (which station this was spent at)
  resourceType?: "message" | "call";
  resourceId?: Types.ObjectId; // → Message or CallLog

  status: CreditTxStatus;
  createdAt: Date;
  updatedAt: Date;
}
