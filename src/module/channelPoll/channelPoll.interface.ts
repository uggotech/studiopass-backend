import { Types } from "mongoose";

// ─── Channel Poll Types ──────────────────────────────────────────────────────

export type ChannelPollStatus = "draft" | "scheduled" | "active" | "completed";
export type ChannelPollBillingMode = "credits" | "free";

// ─── Channel Poll Sub-types ──────────────────────────────────────────────────

export interface TChannelPollNominee {
  name: string;
  photo?: string; // MinIO path
  description?: string;
}

export interface TChannelPollCategory {
  name: string; // "Best Male Presenter"
  nominees: TChannelPollNominee[];
}

// ─── Channel Poll Interface ──────────────────────────────────────────────────

export interface TChannelPoll {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station (the channel)
  title: string;
  description?: string;
  categories: TChannelPollCategory[];
  status: ChannelPollStatus;
  billingMode: ChannelPollBillingMode;
  creditCost: number;
  startDate: Date;
  endDate: Date;
  totalVotes: number; // denormalized
  createdBy: Types.ObjectId; // → User
  createdAt: Date;
  updatedAt: Date;
}

export type TPartialChannelPoll = Partial<TChannelPoll>;

// ─── Channel Poll Vote Interface ─────────────────────────────────────────────

export interface TChannelPollVote {
  _id: Types.ObjectId;
  poll: Types.ObjectId; // → ChannelPoll
  categoryIndex: number;
  nomineeIndex: number;
  user: Types.ObjectId; // → User
  createdAt: Date;
}
