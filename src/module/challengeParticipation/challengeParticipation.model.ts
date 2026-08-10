import { model, Schema } from "mongoose";
import { TChallengeParticipation, TChallengeParticipationAnswer } from "./challengeParticipation.interface";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const participationAnswerSchema = new Schema<TChallengeParticipationAnswer>(
  {
    questionIndex: { type: Number, required: true, min: 0 },
    selectedOption: { type: Number, required: true, min: 0 },
    isCorrect: { type: Boolean, required: true },
  },
  { _id: false },
);

// ─── Schema ──────────────────────────────────────────────────────────────────

const challengeParticipationSchema = new Schema<TChallengeParticipation>(
  {
    challenge: { type: Schema.Types.ObjectId, ref: "Challenge", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    answers: {
      type: [participationAnswerSchema],
      required: true,
    },
    score: { type: Number, default: 0, min: 0 },
    timeTaken: { type: Number, default: 0, min: 0 },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// One participation per user per challenge
challengeParticipationSchema.index({ challenge: 1, user: 1 }, { unique: true });
// For leaderboard queries
challengeParticipationSchema.index({ challenge: 1, score: -1 });

// ─── Model ───────────────────────────────────────────────────────────────────

export const ChallengeParticipation = model<TChallengeParticipation>(
  "ChallengeParticipation",
  challengeParticipationSchema,
);
