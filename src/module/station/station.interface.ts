import { Types } from "mongoose";

export type StationCategory = "radio" | "tv" | "channel";

export interface TStation {
  _id: Types.ObjectId;
  name: string; // "Capital FM Kenya"
  stationCode: string; // "CAP-FM-KE" (unique, used for stationRef in statements)
  category: StationCategory;
  country: Types.ObjectId; // → Country
  partner: Types.ObjectId; // → Partner
  description?: string;
  logo?: string; // MinIO path
  coverImage?: string; // MinIO path
  website?: string;
  socialLinks?: { facebook?: string; instagram?: string };
  apiKey?: string; // generated for TV stations — pull approved messages
  isLive: boolean;
  isActive: boolean;
  isVerified: boolean;
  followersCount: number;
  createdBy?: Types.ObjectId; // → User (who created this station)
  createdAt: Date;
  updatedAt: Date;
}
