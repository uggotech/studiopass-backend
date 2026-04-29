import { Types } from "mongoose";

export type OTPType = "account_verification" | "login";
export type OTPProvider = "phone";

export interface TOTP {
  userId: Types.ObjectId;
  otp: string;
  type: OTPType;
  provider: OTPProvider;
  target: string; // phone number (E.164 format)
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
}

export type TOTPCreate = Omit<TOTP, "attempts" | "maxAttempts" | "isUsed"> & {
  attempts?: number;
  maxAttempts?: number;
  isUsed?: boolean;
};

export type createOTPData = {
  userId: Types.ObjectId;
  type: OTPType;
  provider: OTPProvider;
  target: string; // phone number
  countryName: string; // used to route to AT or Firebase
};

export type PartialTOTP = Partial<TOTP>;
