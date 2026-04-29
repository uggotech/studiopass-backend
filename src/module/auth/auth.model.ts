import { Schema, model } from "mongoose";

import { LoginProvider, TAuth, UserRole } from "./auth.interface";
import generateHashPassword from "util/generateHashPassword";

// ─── Schema ──────────────────────────────────────────────────────────────────

const authSchema = new Schema<TAuth>(
  {
    // Credentials
    phone: { type: String, trim: true },
    countryCode: { type: String, trim: true },
    password: { type: String, select: false },

    // Login provider
    loginProvider: {
      type: String,
      enum: Object.values(LoginProvider),
      required: true,
      default: LoginProvider.PHONE,
    },

    // Verification flags
    isPhoneVerified: { type: Boolean, default: false },

    // Role & access
    role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },

    // Account lifecycle
    status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// Unique phone once verified (allows duplicate unverified values)
authSchema.index(
  { phone: 1, isPhoneVerified: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $exists: true, $type: "string" }, isPhoneVerified: true },
  },
);

// Non-unique lookup index for phone
authSchema.index(
  { phone: 1 },
  { partialFilterExpression: { phone: { $exists: true, $type: "string" } } },
);

// ─── Hooks ───────────────────────────────────────────────────────────────────

authSchema.pre("save", async function (_next) {
  if (this.isModified("password") && this.password) {
    this.password = generateHashPassword(this.password);
  }
});

// ─── Model ───────────────────────────────────────────────────────────────────

export const Auth = model<TAuth>("Auth", authSchema);
