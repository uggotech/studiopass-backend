import { Types } from "mongoose";

// ─── Preferences ─────────────────────────────────────────────────────────────

export interface IUserPreferences {
  theme: "default" | "dark" | "light";
  language: "english" | "swahili";
}

// ─── Profile Completion ───────────────────────────────────────────────────────

/** Fields that must be set for a profile to be considered complete */
export const REQUIRED_PROFILE_FIELDS = ["fullName", "avatar"] as const;

/** Returns true when all required profile fields are non-empty */
export function checkProfileComplete(user: TUser): boolean {
  for (const field of REQUIRED_PROFILE_FIELDS) {
    const value = user[field as keyof TUser];
    if (value === undefined || value === null || value === "") return false;
  }
  return true;
}

import { UserRole } from "module/auth/auth.interface";

// ─── Main Interface ───────────────────────────────────────────────────────────

export interface TUser {
  _id: Types.ObjectId;
  auth: Types.ObjectId; // → Auth document

  fullName?: string;
  avatar?: string;

  // Denormalized from Auth for fast reads
  email?: string;
  phone?: string;
  phoneCountryCode?: string; // e.g. "+1", "+234"
  countryName?: string;      // used for SMS provider routing

  // Access control
  role: UserRole;

  // Profile completion flag (true once fullName + avatar are set)
  profileCompleted: boolean;

  // Account flags
  isBlocked: boolean;
  isDeleted: boolean;

  // Preferences
  preferences: IUserPreferences;

  // Timestamps (managed by Mongoose)
  createdAt: Date;
  updatedAt: Date;
}

export type TPartialUser = Partial<TUser>;

