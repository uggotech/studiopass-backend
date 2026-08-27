import { Types } from "mongoose";

// ─── Status Type ─────────────────────────────────────────────────────────────

export type StatusType = "manual" | "auto_weekly_top_fans";

// ─── Status Top Fan ──────────────────────────────────────────────────────────

export interface TStatusTopFan {
  user: Types.ObjectId; // → User
  name: string; // denormalized
  creditsUsed: number; // total credits used at this station this week
  rank: number; // 1-5
}

// ─── Status Interface ────────────────────────────────────────────────────────

export interface TStatus {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station
  createdBy?: Types.ObjectId; // → User (station admin, null for auto-generated)
  type: StatusType;
  content: string; // text content
  media?: string; // image/video (MinIO path)

  // Auto weekly top fans data (one status per fan — each post is independent)
  topFan?: TStatusTopFan;
  weekStart?: Date;
  weekEnd?: Date;

  // Expiry
  expiresAt: Date;

  // Media type & thumbnail for video
  mediaType?: "image" | "video";
  thumbnail?: string;

  // Engagement counters (denormalized for fast reads)
  viewCount: number;
  likeCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export type TPartialStatus = Partial<TStatus>;
