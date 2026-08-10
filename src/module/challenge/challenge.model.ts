import { model, Schema } from "mongoose";
import { TChallenge, TChallengeQuestion } from "./challenge.interface";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const challengeOptionSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    isCorrect: { type: Boolean, required: true },
  },
  { _id: false },
);

const challengeQuestionSchema = new Schema<TChallengeQuestion>(
  {
    text: { type: String, required: true, trim: true },
    options: {
      type: [challengeOptionSchema],
      required: true,
      validate: [(v: any[]) => v.length >= 2, "At least 2 options required"],
    },
    timeLimit: { type: Number, min: 5, max: 300 },
  },
  { _id: false },
);

// ─── Schema ──────────────────────────────────────────────────────────────────

const challengeSchema = new Schema<TChallenge>(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["quiz", "fastest_answer", "question_of_day"],
      required: true,
    },
    description: { type: String, required: true, trim: true },
    instructions: { type: String, trim: true },
    startDate: { type: Date, required: true },
    startTime: { type: String, required: true },
    endDate: { type: Date, required: true },
    endTime: { type: String, required: true },
    questions: {
      type: [challengeQuestionSchema],
      required: true,
      validate: [(v: TChallengeQuestion[]) => v.length >= 1, "At least 1 question required"],
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "completed", "cancelled"],
      default: "draft",
    },
    billingMode: {
      type: String,
      enum: ["credits", "free"],
      default: "free",
    },
    creditCost: { type: Number, default: 1, min: 0 },
    totalParticipants: { type: Number, default: 0, min: 0 },
    rewardText: { type: String, trim: true, default: "" },
    prizeType: { type: Schema.Types.ObjectId, ref: "PrizeType" },
    prizeTypeKey: { type: String, trim: true },
    prizeLabel: { type: String, trim: true },
    prizeValue: { type: String, trim: true },
    currency: { type: String, trim: true },
    numberOfWinners: { type: Number, default: 1, min: 1 },
    sponsorName: { type: String, trim: true },
    collectionInstructions: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

challengeSchema.index({ station: 1, status: 1 });
challengeSchema.index({ station: 1, startDate: -1 });

// ─── Model ───────────────────────────────────────────────────────────────────

export const Challenge = model<TChallenge>("Challenge", challengeSchema);
