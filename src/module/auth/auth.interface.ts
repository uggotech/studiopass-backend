import { UserRole } from "shared/roles";
import { Types } from "mongoose";

export enum LoginProvider {
  PHONE = "phone",
  USERNAME = "username",
}


export interface TAuth {
  _id: Types.ObjectId;

  // Dashboard login (username + password)
  username?: string; // unique for dashboard users
  password?: string; // hashed with bcrypt, required when loginProvider = "username"

  // App login (phone + OTP)
  phone?: string; // E.164 format for app users
  countryCode?: string; // e.g. "+256"
  isPhoneVerified: boolean; // true after OTP verified

  // Common
  loginProvider: LoginProvider; // "username" (dashboard) | "phone" (app)
  role: UserRole; // stored on Auth for JWT payload
  status: "active" | "inactive" | "suspended";
  lastLogin?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}


