import mongoose from "mongoose";
import { Poll } from "./poll.model";
import { PollVote } from "./pollVote.model";

const create = (data: Record<string, unknown>) => {
  const doc = new Poll(data);
  return doc.save().then((d) => d.toObject());
};

const findById = async (id: string, userId?: string) => {
  const poll = await Poll.findById(id)
    .populate("station", "name stationCode")
    .populate("show", "name")
    .populate("createdBy", "fullName")
    .lean();
  if (!poll || !userId) return poll;

  const vote = await PollVote.findOne({ poll: id, user: userId }).lean();
  return { ...poll, isVotedByMe: !!vote };
};

const findByStation = async (stationId: string, skip: number, limit: number, status?: string, userId?: string) => {
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;
  const polls = await Poll.find(filter)
    .populate("createdBy", "fullName")
    .populate("show", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  if (!userId || polls.length === 0) return polls;

  const pollIds = polls.map((p: any) => p._id);
  const votes = await PollVote.find({ poll: { $in: pollIds }, user: userId })
    .select("poll")
    .lean();
  const votedPollIds = new Set(votes.map((v: any) => v.poll.toString()));

  return polls.map((p: any) => ({
    ...p,
    isVotedByMe: votedPollIds.has(p._id.toString()),
  }));
};

const countByStation = (stationId: string, status?: string) => {
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;
  return Poll.countDocuments(filter);
};

const findAll = async (filter: Record<string, unknown>, opts: { skip: number; limit: number }, userId?: string) => {
  const polls = await Poll.find(filter)
    .populate("createdBy", "fullName")
    .populate("show", "name")
    .populate("station", "name stationCode")
    .sort({ createdAt: -1 })
    .skip(opts.skip)
    .limit(opts.limit)
    .lean();

  if (!userId || polls.length === 0) return polls;

  const pollIds = polls.map((p: any) => p._id);
  const votes = await PollVote.find({ poll: { $in: pollIds }, user: userId })
    .select("poll")
    .lean();
  const votedPollIds = new Set(votes.map((v: any) => v.poll.toString()));

  return polls.map((p: any) => ({
    ...p,
    isVotedByMe: votedPollIds.has(p._id.toString()),
  }));
};

const count = (filter: Record<string, unknown>) => {
  return Poll.countDocuments(filter);
};

const updateById = (id: string, update: Record<string, unknown>) => {
  return Poll.findByIdAndUpdate(id, update, { returnDocument: "after" }).lean();
};

const deleteById = (id: string) => {
  return Poll.findByIdAndDelete(id);
};

const vote = async (pollId: string, optionIndex: number, userId: string) => {
  // Atomic vote: create PollVote + increment poll counter
  // If the unique constraint fails (duplicate vote), return null
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Try to create the vote record (unique index enforces one-vote-per-user)
    await PollVote.create([{
      poll: pollId,
      user: userId,
      optionIndex,
    }], { session });

    // Increment poll counters
    const updated = await Poll.findByIdAndUpdate(
      pollId,
      {
        $inc: { totalVotes: 1, [`options.${optionIndex}.votes`]: 1 },
      },
      { returnDocument: "after", session },
    ).lean();

    await session.commitTransaction();
    return updated;
  } catch (error: any) {
    await session.abortTransaction();
    // Duplicate key error = user already voted
    if (error?.code === 11000) {
      return { alreadyVoted: true };
    }
    throw error;
  } finally {
    session.endSession();
  }
};

const hasVoted = async (pollId: string, userId: string) => {
  const vote = await PollVote.findOne({ poll: pollId, user: userId }).lean();
  return !!vote;
};

const deleteVotesByPoll = (pollId: string) => {
  return PollVote.deleteMany({ poll: pollId });
};

export const PollRepository = {
  create,
  findById,
  findByStation,
  countByStation,
  findAll,
  count,
  updateById,
  deleteById,
  vote,
  hasVoted,
  deleteVotesByPoll,
};
