import { Types } from "mongoose";

export type BroadcastType = "tv" | "radio" | "channel";

export interface IBroadcastSocialLinks {
  facebook?: string;
  instagram?: string;
}

export interface TBroadcast {
  _id: Types.ObjectId;
  name: string;
  type: BroadcastType;
  description?: string;
  country: string;
  mottoLine?: string;
  logo?: string;
  coverImage?: string;
  streamUrl: string;
  category: string[];
  website?: string;
  socialLinks?: IBroadcastSocialLinks;
  isLive: boolean;
  liveTitle?: string;
  followersCount: number;
  isActive: boolean;
  isVerified: boolean;
  createdBy?: Types.ObjectId;
  lastNotificationAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TPartialBroadcast = Partial<TBroadcast>;
