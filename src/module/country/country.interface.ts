import { Types } from "mongoose";

export interface TCountry {
  _id: Types.ObjectId;
  name: string;
  code: string;
  phoneCode: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  messageCreditPrice: number;
  callCreditPrice: number;
  smsProviders: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}


