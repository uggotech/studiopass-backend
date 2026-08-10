import { Types } from "mongoose";

export type StationCategory = "radio" | "tv" | "channel";
export type ChannelType = "challenges" | "polls" | "message_chat";

export interface TStation {
  _id: Types.ObjectId;
  name: string; // "Capital FM Kenya"
  stationCode: string; // "CAP-FM-KE" (unique, used for stationRef in statements)
  category: StationCategory;
  channelType?: ChannelType; // Only for category="channel": "challenges" | "polls" | "message_chat"
  country: Types.ObjectId; // → Country
  partner: Types.ObjectId; // → Partner
  description?: string;
  logo?: string; // MinIO path
  coverImage?: string; // MinIO path
  website?: string;
  socialLinks?: { facebook?: string; instagram?: string };
  isLive: boolean;
  isActive: boolean;
  isVerified: boolean;
  followersCount: number;
  createdBy?: Types.ObjectId; // → User (who created this station)

  // Status scheduling config (per-station weekly top fans)
  statusConfig?: {
    weeklyTopFansDay: string; // "monday" | "tuesday" | ... | "sunday"
    weeklyTopFansTime: string; // "00:00" (HH:mm) — time in station's country timezone
    autoPostExpiryHours: number; // hours until auto-post expires (default: 168 = 7 days)
  };

  createdAt: Date;
  updatedAt: Date;
}
