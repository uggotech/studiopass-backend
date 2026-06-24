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

  // Auto weekly top fans data
  topFans?: TStatusTopFan[];
  weekStart?: Date;
  weekEnd?: Date;

  // Expiry
  expiresAt: Date;

  // View count (denormalized for fast reads)
  viewCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export type TPartialStatus = Partial<TStatus>;
