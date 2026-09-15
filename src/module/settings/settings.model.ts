import { model, Schema } from "mongoose";
import { TSecuritySettings } from "./settings.interface";
import { UserRole } from "shared/roles";

const securitySettingsSchema = new Schema<TSecuritySettings>(
  {
    _id: { type: String, default: "security" },
    enforce2FA: { type: Boolean, default: false },
    enforcedRoles: {
      type: [String],
      enum: Object.values(UserRole).filter((r) => r !== "user"),
      default: [],
    },
  },
  { timestamps: true },
);

export const Settings = model<TSecuritySettings>("Settings", securitySettingsSchema);
