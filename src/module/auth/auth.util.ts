import crypto from "crypto";
import { LoginProvider, UserRole } from "./auth.interface";
import { Types } from "mongoose";

// ─── Token Payload ───────────────────────────────────────

export type TTokenPayload = {
  userId: string;
  authId: string;
  email?: string;
  phone?: string;
  role: UserRole;
  loginProvider: LoginProvider;
};

// ─── Helpers ─────────────────────────────────────────────

export const getNormalizedIdentity = (payload: { email?: string; phone?: string }) => {
  return {
    email: payload.email?.trim().toLowerCase(),
    phone: payload.phone?.trim(),
  };
};

export const getOtpChannel = (auth: {
  phone?: string;
}) => {
  if (auth.phone) {
    return { provider: "phone" as const, target: auth.phone };
  }
  return null;
};

export const buildTokenPayload = (
  auth: {
    _id: string | Types.ObjectId;
    email?: string;
    phone?: string;
    role: UserRole;
    loginProvider: LoginProvider;
  },
  userId: string | Types.ObjectId,
): TTokenPayload => ({
  userId: String(userId),
  authId: String(auth._id),
  email: auth.email,
  phone: auth.phone,
  role: auth.role,
  loginProvider: auth.loginProvider,
});

/** Build a human-friendly fallback label from the best known identity value. */
export const getIdentityLabel = (
  identity?: string,
  loginProvider?: LoginProvider,
): string => {
  const cleanedIdentity = identity?.trim();

  if (cleanedIdentity) {
    if (cleanedIdentity.includes("@")) {
      return cleanedIdentity.split("@")[0] || "StudioPass User";
    }

    const digitsOnly = cleanedIdentity.replace(/\D/g, "");
    if (digitsOnly) {
      return `User ${digitsOnly.slice(-4)}`;
    }

    return cleanedIdentity;
  }

  if (loginProvider) {
    const suffix = crypto.randomBytes(2).toString("hex");
    return `${loginProvider}_user_${suffix}`;
  }

  return "StudioPass User";
};
