import { model, Schema } from "mongoose";
import { TChannelPoll, TChannelPollCategory, TChannelPollNominee, TChannelPollVote } from "./channelPoll.interface";

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const channelPollNomineeSchema = new Schema<TChannelPollNominee>(
  {
    name: { type: String, required: true, trim: true },
    photo: { type: String },
    description: { type: String, trim: true },
  },
  { _id: false },
);

const channelPollCategorySchema = new Schema<TChannelPollCategory>(
  {
    name: { type: String, required: true, trim: true },
    nominees: {
      type: [channelPollNomineeSchema],
      required: true,
      validate: [(v: TChannelPollNominee[]) => v.length >= 2, "At least 2 nominees required"],
    },
  },
  { _id: false },
);

// ─── ChannelPoll Schema ──────────────────────────────────────────────────────

const channelPollSchema = new Schema<TChannelPoll>(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    categories: {
      type: [channelPollCategorySchema],
      required: true,
      validate: [(v: TChannelPollCategory[]) => v.length >= 1, "At least 1 category required"],
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "active", "completed"],
      default: "draft",
    },
    billingMode: {
      type: String,
      enum: ["credits", "free"],
      default: "free",
    },
    creditCost: { type: Number, default: 1, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalVotes: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

channelPollSchema.index({ status: 1 });
channelPollSchema.index({ station: 1, status: 1 });
channelPollSchema.index({ station: 1, startDate: -1 });

// ─── ChannelPollVote Schema ──────────────────────────────────────────────────

const channelPollVoteSchema = new Schema<TChannelPollVote>(
  {
    poll: { type: Schema.Types.ObjectId, ref: "ChannelPoll", required: true },
    categoryIndex: { type: Number, required: true, min: 0 },
    nomineeIndex: { type: Number, required: true, min: 0 },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One vote per category per user per poll
channelPollVoteSchema.index({ poll: 1, categoryIndex: 1, user: 1 }, { unique: true });
// For result queries
channelPollVoteSchema.index({ poll: 1, nomineeIndex: 1 });

// ─── Models ──────────────────────────────────────────────────────────────────

export const ChannelPoll = model<TChannelPoll>("ChannelPoll", channelPollSchema);
export const ChannelPollVote = model<TChannelPollVote>("ChannelPollVote", channelPollVoteSchema);
