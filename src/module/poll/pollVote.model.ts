import { model, Schema, Types } from "mongoose";

export interface TPollVote {
  _id: Types.ObjectId;
  poll: Types.ObjectId; // → Poll
  user: Types.ObjectId; // → User
  optionIndex: number; // which option was voted for
  createdAt: Date;
}

const pollVoteSchema = new Schema<TPollVote>(
  {
    poll: {
      type: Schema.Types.ObjectId,
      ref: "Poll",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    optionIndex: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true },
);

// Unique compound index: one vote per user per poll
pollVoteSchema.index({ poll: 1, user: 1 }, { unique: true });

export const PollVote = model<TPollVote>("PollVote", pollVoteSchema);
