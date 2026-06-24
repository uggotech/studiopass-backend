import { model, Schema } from "mongoose";
import { TUser } from "./user.interface";

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
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    phoneCountryCode: { type: String, trim: true },
    countryName: { type: String },
    countryId: { type: Schema.Types.ObjectId, ref: "Country" },
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
    partnerId: { type: Schema.Types.ObjectId, ref: "Partner" },
    stationId: { type: Schema.Types.ObjectId, ref: "Station" },
    profileCompleted: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    preferences: {
      type: {
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
      default: () => ({}),
    },
    fcmToken: { type: String, trim: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 });
userSchema.index({ phone: 1, phoneCountryCode: 1 });
userSchema.index({ role: 1 });
userSchema.index({ partnerId: 1 });
userSchema.index({ stationId: 1 });
userSchema.index({ countryName: 1 });
userSchema.index({ countryId: 1 });

export const User = model<TUser>("User", userSchema);
