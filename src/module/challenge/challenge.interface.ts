import { Types } from "mongoose";

// ─── Challenge Types ─────────────────────────────────────────────────────────

export type ChallengeType = "quiz" | "fastest_answer" | "question_of_day";
export type ChallengeStatus = "draft" | "scheduled" | "active" | "completed" | "cancelled";
export type BillingMode = "credits" | "free";

// ─── Challenge Question ──────────────────────────────────────────────────────

export interface TChallengeOption {
  label: string;
  isCorrect: boolean;
}

export interface TChallengeQuestion {
  text: string;
  options: TChallengeOption[];
  timeLimit?: number; // seconds (quiz/fastest_answer only)
}

// ─── Challenge Interface ─────────────────────────────────────────────────────

export interface TChallenge {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station (the channel)
  title: string;
  type: ChallengeType;
  description: string;
  instructions?: string;
  startDate: Date;
  startTime: string; // "14:00" (HH:mm)
  endDate: Date;
  endTime: string; // "16:00" (HH:mm)
  questions: TChallengeQuestion[];
  status: ChallengeStatus;
  billingMode: BillingMode;
  creditCost: number; // default 1
  totalParticipants: number; // denormalized count
  rewardText: string; // FREE TEXT — "Top 5 get certificates" etc.
  prizeType?: Types.ObjectId; // -> PrizeType
  prizeTypeKey?: string; // e.g. "mobile_money"
  prizeLabel?: string; // e.g. "Mobile Money"
  prizeValue?: string; // e.g. "20000", "20", "Busoga Hoodie"
  currency?: string; // e.g. "UGX"
  numberOfWinners?: number; // default 1
  sponsorName?: string;
  collectionInstructions?: string;
  createdBy: Types.ObjectId; // → User
  createdAt: Date;
  updatedAt: Date;
}

export type TPartialChallenge = Partial<TChallenge>;
