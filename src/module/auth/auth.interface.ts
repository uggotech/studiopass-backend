import { Types } from "mongoose";

// ─── Enums ───────────────────────────────────────────────

export enum LoginProvider {
  PHONE = "phone",
}

export enum UserRole {
  USER = "user",
  ADMIN = "admin",
}

// ─── Auth Interface ──────────────────────────────────────

export interface TAuth {
  _id: Types.ObjectId;

  // Credentials
  phone?: string;
  countryCode?: string;
  password?: string;

  // Login provider & OAuth IDs
  loginProvider: LoginProvider;

  // Verification flags
  isPhoneVerified: boolean;

  // Role & access
  role: UserRole;

  // Account lifecycle
  status: "active" | "inactive" | "suspended";
  lastLogin?: Date | null;

  // Timestamps (managed by Mongoose)
  createdAt: Date;
  updatedAt: Date;
}

export type TPartialAuth = Partial<TAuth>;
