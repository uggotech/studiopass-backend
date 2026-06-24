import { Types } from "mongoose";

export type StatementType = "Call" | "Message";
export type StatementStatus = "Successful" | "Failed" | "Pending";

export interface TListenerStatement {
  _id: Types.ObjectId;
  statementId: string; // "LS-{timestamp}{random}"
  user: Types.ObjectId; // → User (the listener)
  type: StatementType; // "Call" | "Message"

  sourceModel: "Message" | "Call";
  sourceId: Types.ObjectId;

  msisdn: string;
  station: Types.ObjectId;
  stationRef: string; // stationCode
  mediaStation: string; // station name

  show?: Types.ObjectId;
  showName?: string;

  amount: number; // creditsUsed × countryCreditPrice
  currency: string;
  currencySymbol: string;
  creditsUsed: number;

  country: Types.ObjectId;
  operator?: string;

  ticket: string; // "TKT-{random}"

  status: StatementStatus;

  createdAt: Date;
  updatedAt: Date;
}
