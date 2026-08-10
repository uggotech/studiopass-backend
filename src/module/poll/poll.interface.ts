import { Types } from "mongoose";

// ─── Poll Status ─────────────────────────────────────────────────────────────

export type PollStatus = "draft" | "active" | "completed";

// ─── Poll Option ─────────────────────────────────────────────────────────────

export interface TPollOption {
  label: string;
  imageUrl?: string | null;
  votes: number;
}

// ─── Poll Interface ──────────────────────────────────────────────────────────

export interface TPoll {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station
  show?: Types.ObjectId; // → Show
  question: string;
  options: TPollOption[];
  status: PollStatus;
  totalVotes: number;
  createdBy: Types.ObjectId; // → User
  expiresAt?: Date; // null = no limit, poll stays active until manually completed
  createdAt: Date;
  updatedAt: Date;
}

export type TPartialPoll = Partial<TPoll>;
