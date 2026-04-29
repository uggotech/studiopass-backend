import { Schema, model } from "mongoose";

import { TUser, IUserPreferences } from "./user.interface";
import { UserRole } from "module/auth/auth.interface";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const preferencesSchema = new Schema<IUserPreferences>(
  {
    theme: {
      type: String,
      enum: ["default", "dark", "light"],
      default: "default",
    },
    language: {
      type: String,
      enum: ["english", "swahili"],
      default: "english",
    },
  },
  { _id: false },
);

// ─── Schema ──────────────────────────────────────────────────────────────────

const userSchema = new Schema<TUser>(
  {
    auth: {
      type: Schema.Types.ObjectId,
      ref: "Auth",
      required: true,
      unique: true,
    },

    fullName: { type: String, trim: true },
    avatar: { type: String },

    // Denormalized from Auth for fast reads
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    phoneCountryCode: { type: String, trim: true }, // e.g. "+1", "+234"
    countryName: { type: String },                  // used for SMS provider routing

    // Access control
    role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },

    // Profile completion flag
    profileCompleted: { type: Boolean, default: false },

    // Account flags
    isBlocked: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },

    // Preferences
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

userSchema.index({ email: 1 });
userSchema.index({ phone: 1, phoneCountryCode: 1 });

// ─── Model ───────────────────────────────────────────────────────────────────

export const User = model<TUser>("User", userSchema);

export const syncUserIndexes = () => User.syncIndexes();
