import { model, Schema } from "mongoose";
import { TAuth } from "./auth.interface";

const authSchema = new Schema<TAuth>(
  {
    // Dashboard fields
    username: { type: String, trim: true, sparse: true },
    password: { type: String },

    // App fields
    phone: { type: String, trim: true },
    countryCode: { type: String, trim: true },
    isPhoneVerified: { type: Boolean, default: false },

    // Common
    loginProvider: {
      type: String,
      enum: ["phone", "username"],
      required: true,
    },
    role: {
      type: String,
      enum: [
        "super_admin",
        "partner_admin",
        "station_admin",
        "media_station",
        "presenter",
        "customer_care",
        "user",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "active",
    },
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

// Unique username for dashboard users
authSchema.index(
  { username: 1 },
  {
    unique: true,
    partialFilterExpression: { username: { $exists: true, $type: "string" } },
  },
);

// Unique verified phone for app users
authSchema.index(
  { phone: 1, isPhoneVerified: 1 },
  {
    unique: true,
    partialFilterExpression: {
      phone: { $exists: true, $type: "string" },
      isPhoneVerified: true,
    },
  },
);

export const Auth = model<TAuth>("Auth", authSchema);
