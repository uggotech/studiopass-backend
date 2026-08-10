import { Types } from "mongoose";

// ─── Challenge Participation Interface ───────────────────────────────────────

export interface TChallengeParticipationAnswer {
  questionIndex: number;
  selectedOption: number;
  isCorrect: boolean;
}

export interface TChallengeParticipation {
  _id: Types.ObjectId;
  challenge: Types.ObjectId; // → Challenge
  user: Types.ObjectId; // → User
  answers: TChallengeParticipationAnswer[];
  score: number;
  timeTaken: number; // total seconds
  submittedAt: Date;
}

export type TPartialChallengeParticipation = Partial<TChallengeParticipation>;
