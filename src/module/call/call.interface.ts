import { Types } from "mongoose";

// ─── Call Status ─────────────────────────────────────────────────────────────

export type CallStatus = "missed" | "rejected" | "answered";

// ─── Call Log Interface ──────────────────────────────────────────────────────

export interface TCallLog {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station
  show?: Types.ObjectId; // → Show
  startedBy: Types.ObjectId; // → User (listener)
  handledBy?: Types.ObjectId; // → User (media station)

  // Agora session
  agoraChannelId: string;
  agoraResourceId?: string; // for future call recording

  // Timing
  duration?: number; // seconds (only for answered)
  startedAt: Date;
  answeredAt?: Date;
  endedAt?: Date;

  status: CallStatus;

  // Cost tracking (only answered/rejected cost credits)
  creditsUsed: number;
  creditTransaction?: Types.ObjectId; // → CreditTransaction

  // Context
  country: Types.ObjectId; // → Country
  operator?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type TPartialCallLog = Partial<TCallLog>;
