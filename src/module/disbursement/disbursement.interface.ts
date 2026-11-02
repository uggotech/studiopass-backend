import { Types } from "mongoose";

export type DisbursementStatus = "pending" | "processing" | "successful" | "failed" | "cancelled";

export interface TDisbursement {
  _id: Types.ObjectId;
  challenge: Types.ObjectId;
  winnerUser: Types.ObjectId;
  winnerName: string;
  phone: string;
  station: Types.ObjectId;
  prizeTypeKey: string;
  prizeLabel: string;
  prizeValue: string;
  txRef?: string;
  provider?: string;
  providerRequestId?: string;
  providerReference?: string;
  // Set when accounts paid the prize outside the system (e.g. MTN) and recorded it in the dashboard
  markedPaidBy?: Types.ObjectId;
  markedPaidAt?: Date;
  manualNote?: string;
  status: DisbursementStatus;
  failureReason?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
