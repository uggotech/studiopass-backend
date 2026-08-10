import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ChannelPollRepository } from "./channelPoll.repository";
import { StationRepository } from "../station/station.repository";
import { CreditService } from "../credit/credit.service";
import { emitToStation } from "../../socket";

const createPoll = async (
  stationId: string,
  data: {
    title: string;
    description?: string;
    categories: { name: string; nominees: { name: string; photo?: string; description?: string }[] }[];
    billingMode?: string;
    creditCost?: number;
    startDate: string;
    endDate: string;
    status?: string;
  },
  createdBy: string,
  userRole?: string,
) => {
  const station: any = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  if (station.category === "channel") {
    if (userRole && !["super_admin", "partner_admin", "station_admin"].includes(userRole)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "Unauthorized to create polls for this Channel.",
      );
    }
  }

  const poll = await ChannelPollRepository.create({
    station: stationId,
    title: data.title,
    description: data.description,
    categories: data.categories,
    status: data.status || "active",
    billingMode: data.billingMode || "free",
    creditCost: data.creditCost || 1,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
    totalVotes: 0,
    createdBy,
  });

  return poll;
};

const getStationPolls = async (
  stationId: string,
  page: number,
  limit: number,
  status?: string,
) => {
  const skip = (page - 1) * limit;
  const [polls, total] = await Promise.all([
    ChannelPollRepository.findByStation(stationId, skip, limit, status),
    ChannelPollRepository.countByStation(stationId, status),
  ]);

  // Auto-complete expired polls
  const now = new Date();
  for (const poll of polls) {
    if (poll.status === "active" && new Date(poll.endDate) <= now) {
      await ChannelPollRepository.updateById(poll._id.toString(), { status: "completed" });
      poll.status = "completed";
    }
  }

  return {
    polls,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getAllPolls = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string; role?: string },
) => {
  const filter: Record<string, unknown> = {};

  if (query.station) {
    filter.station = query.station;
  } else if (scope?.role === "station_admin" && scope.stationId) {
    filter.station = scope.stationId;
  } else if (scope?.role === "partner_admin" && scope.partnerId) {
    const partnerStations = await StationRepository.findAll({ partner: scope.partnerId }, { limit: 1000 });
    filter.station = { $in: partnerStations.map((s: any) => s._id) };
  }

  if (query.status) filter.status = query.status;

  if (query.search) {
    const escaped = (query.search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.title = new RegExp(escaped, "i");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [polls, total] = await Promise.all([
    ChannelPollRepository.findAll(filter, { skip, limit }),
    ChannelPollRepository.count(filter),
  ]);

  return {
    polls,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getPollById = async (id: string, userId?: string) => {
  const poll: any = await ChannelPollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }

  const results = await ChannelPollRepository.getResults(id);
  const userVotes = userId ? await ChannelPollRepository.getUserVotes(id, userId) : [];

  if (results) {
    poll.categories = poll.categories.map((category: any, catIdx: number) => {
      const catResults = results[catIdx];
      const userCategoryVote = userVotes.find((v: any) => v.categoryIndex === catIdx);

      const nominees = category.nominees.map((nominee: any, nomIdx: number) => {
        const nomRes = catResults?.nominees?.[nomIdx];
        const isVotedByMe = userCategoryVote?.nomineeIndex === nomIdx;

        return {
          ...nominee,
          voteCount: nomRes?.voteCount || 0,
          percentage: nomRes?.percentage || 0,
          isVotedByMe,
        };
      });

      return {
        ...category,
        isVotedByMe: !!userCategoryVote,
        nominees,
      };
    });
  }

  return poll;
};

const votePoll = async (
  pollId: string,
  categoryIndex: number,
  nomineeIndex: number,
  userId: string,
) => {
  const mongoose = await import("mongoose");
  const poll = await ChannelPollRepository.findById(pollId);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }

  if (poll.status !== "active") {
    throw new AppError(StatusCodes.BAD_REQUEST, "This poll is not active.");
  }

  // Validate category index
  if (categoryIndex < 0 || categoryIndex >= poll.categories.length) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid category index.");
  }

  // Validate nominee index
  const category = poll.categories[categoryIndex];
  if (!category || nomineeIndex < 0 || nomineeIndex >= category.nominees.length) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid nominee index.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check if user already voted in this category inside transaction
    const alreadyVoted = await ChannelPollRepository.hasVotedInCategory(pollId, categoryIndex, userId);
    if (alreadyVoted) {
      throw new AppError(StatusCodes.CONFLICT, "You have already voted in this category.");
    }

    // Check billing
    if (poll.billingMode === "credits" && poll.creditCost > 0) {
      await CreditService.deductCredits(
        userId,
        poll.creditCost,
        poll.station.toString(),
        pollId,
        "poll",
        session,
      );
    }

    const updated = await ChannelPollRepository.vote(pollId, categoryIndex, nomineeIndex, userId);
    if (!updated || (updated as any).alreadyVoted) {
      throw new AppError(StatusCodes.CONFLICT, "You have already voted in this category.");
    }

    await session.commitTransaction();

    // Emit socket event
    try {
      emitToStation(poll.station.toString(), "channel-poll-updated", { pollId });
    } catch {}

    return updated;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const getPollResults = async (pollId: string, userId?: string) => {
  const poll = await ChannelPollRepository.findById(pollId);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }

  const results = await ChannelPollRepository.getResults(pollId);
  let userVotes: any[] = [];
  if (userId) {
    userVotes = await ChannelPollRepository.getUserVotes(pollId, userId);
  }

  return {
    poll: {
      id: poll._id,
      title: poll.title,
      description: poll.description,
      status: poll.status,
      totalVotes: poll.totalVotes,
    },
    results,
    userVotes,
  };
};

const updatePoll = async (id: string, updates: Record<string, unknown>) => {
  const poll = await ChannelPollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  return ChannelPollRepository.updateById(id, updates);
};

const deletePoll = async (id: string) => {
  const poll = await ChannelPollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  await ChannelPollRepository.deleteById(id);
  // Clean up votes (best-effort)
  try {
    await ChannelPollRepository.deleteVotesByPoll(id);
  } catch {}
};

export const ChannelPollService = {
  createPoll,
  getStationPolls,
  getAllPolls,
  getPollById,
  votePoll,
  getPollResults,
  updatePoll,
  deletePoll,
};
