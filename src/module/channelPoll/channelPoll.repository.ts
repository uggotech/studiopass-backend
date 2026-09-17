import mongoose from "mongoose";
import { ChannelPoll } from "./channelPoll.model";
import { ChannelPollVote } from "./channelPoll.model";

const create = (data: Record<string, unknown>) => {
  const doc = new ChannelPoll(data);
  return doc.save().then((d) => d.toObject());
};

const findById = (id: string) => {
  return ChannelPoll.findById(id)
    .populate("station", "name stationCode")
    .populate({
      path: "station",
      populate: { path: "country", select: "name code timezone currency" },
    })
    .populate("createdBy", "fullName")
    .lean();
};

const findByStation = (stationId: string, skip: number, limit: number, status?: string) => {
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;
  return ChannelPoll.find(filter)
    .populate("createdBy", "fullName")
    .sort({ startDate: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countByStation = (stationId: string, status?: string) => {
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;
  return ChannelPoll.countDocuments(filter);
};

const findAll = (filter: Record<string, unknown>, opts: { skip: number; limit: number }) => {
  return ChannelPoll.find(filter)
    .populate("createdBy", "fullName")
    .populate("station", "name stationCode")
    .sort({ startDate: -1 })
    .skip(opts.skip)
    .limit(opts.limit)
    .lean();
};

const count = (filter: Record<string, unknown>) => {
  return ChannelPoll.countDocuments(filter);
};

const updateById = (id: string, update: Record<string, unknown>) => {
  return ChannelPoll.findByIdAndUpdate(id, update, { returnDocument: "after" }).lean();
};

const deleteById = (id: string) => {
  return ChannelPoll.findByIdAndDelete(id);
};

// ─── Vote operations ─────────────────────────────────────────────────────────

const vote = async (
  pollId: string,
  categoryIndex: number,
  nomineeIndex: number,
  userId: string,
  session?: mongoose.ClientSession,
) => {
  const run = async (s: mongoose.ClientSession | undefined) => {
    await ChannelPollVote.create(
      [
        {
          poll: pollId,
          categoryIndex,
          nomineeIndex,
          user: userId,
        },
      ],
      s ? { session: s } : {},
    );

    return ChannelPoll.findByIdAndUpdate(
      pollId,
      { $inc: { totalVotes: 1 } },
      { returnDocument: "after", ...(s ? { session: s } : {}) },
    ).lean();
  };

  if (session) {
    // Caller owns the transaction (credits + vote together)
    return run(session);
  }

  const ownSession = await mongoose.startSession();
  ownSession.startTransaction();
  try {
    const updated = await run(ownSession);
    await ownSession.commitTransaction();
    return updated;
  } catch (error: any) {
    await ownSession.abortTransaction();
    if (error?.code === 11000) {
      return { alreadyVoted: true };
    }
    throw error;
  } finally {
    ownSession.endSession();
  }
};

const hasVotedInCategory = async (pollId: string, categoryIndex: number, userId: string) => {
  const vote = await ChannelPollVote.findOne({
    poll: pollId,
    categoryIndex,
    user: userId,
  }).lean();
  return !!vote;
};

const getUserVotes = async (pollId: string, userId: string) => {
  return ChannelPollVote.find({
    poll: pollId,
    user: userId,
  }).lean();
};

const getResults = async (pollId: string) => {
  const poll = await ChannelPoll.findById(pollId).lean();
  if (!poll) return null;

  // Get vote counts per category per nominee
  const votes = await ChannelPollVote.find({ poll: pollId }).lean();

  const results = poll.categories.map((category, catIdx) => {
    const categoryVotes = votes.filter((v) => v.categoryIndex === catIdx);
    const nominees = category.nominees.map((nominee, nomIdx) => {
      const nomineeVotes = categoryVotes.filter((v) => v.nomineeIndex === nomIdx).length;
      return {
        name: nominee.name,
        photo: nominee.photo,
        description: nominee.description,
        voteCount: nomineeVotes,
        percentage: categoryVotes.length > 0
          ? Math.round((nomineeVotes / categoryVotes.length) * 100)
          : 0,
      };
    });
    return {
      name: category.name,
      nominees,
      totalVotes: categoryVotes.length,
    };
  });

  return results;
};

const deleteVotesByPoll = (pollId: string) => {
  return ChannelPollVote.deleteMany({ poll: pollId });
};

export const ChannelPollRepository = {
  create,
  findById,
  findByStation,
  countByStation,
  findAll,
  count,
  updateById,
  deleteById,
  vote,
  hasVotedInCategory,
  getUserVotes,
  getResults,
  deleteVotesByPoll,
};
