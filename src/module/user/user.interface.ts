import { Types } from "mongoose";
import { UserRole } from "shared/roles";

export { UserRole } from "shared/roles";

export interface TUser {
  _id: Types.ObjectId;
  auth: Types.ObjectId; // → Auth

  fullName?: string;
  avatar?: string; // MinIO path
  email?: string;

  // Denormalized from Auth for fast reads
  phone?: string;
  phoneCountryCode?: string;
  countryName?: string;
  countryId?: Types.ObjectId; // → Country (for app users — listeners)

  // Access control
  role: UserRole;

  // Scope (exactly one based on role)
  partnerId?: Types.ObjectId; // → Partner (for partner_admin, customer_care)
  stationId?: Types.ObjectId; // → Station (for station_admin, media_station, presenter)

  // Profile
  profileCompleted: boolean;

  // Account flags
  isBlocked: boolean;
  isDeleted: boolean;

  // Preferences
  preferences: {
    theme: "default" | "dark" | "light";
    language: "english" | "swahili";
  };

  // Push notification
  fcmToken?: string;

  createdAt: Date;
  updatedAt: Date;
}
