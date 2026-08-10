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
  status: DisbursementStatus;
  failureReason?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
