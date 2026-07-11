import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { PollRepository } from "./poll.repository";
import { StationRepository } from "../station/station.repository";
import { emitToStation } from "../../socket";

const createPoll = async (
  stationId: string,
  question: string,
  options: string[],
  createdBy: string,
  showId?: string,
  expiresAt?: string,
) => {
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const poll = await PollRepository.create({
    station: stationId,
    show: showId || undefined,
    question,
    options: options.map((label) => ({ label, votes: 0 })),
    status: "active",
    createdBy,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });

  try {
    emitToStation(stationId, "new-poll", { poll });
  } catch {}

  return poll;
};

const getStationPolls = async (stationId: string, page: number, limit: number, status?: string) => {
  const skip = (page - 1) * limit;
  const [polls, total] = await Promise.all([
    PollRepository.findByStation(stationId, skip, limit, status),
    PollRepository.countByStation(stationId, status),
  ]);

  // Auto-complete expired polls
  const now = new Date();
  for (const poll of polls) {
    if (poll.status === "active" && poll.expiresAt && new Date(poll.expiresAt) <= now) {
      await PollRepository.updateById(poll._id.toString(), { status: "completed" });
      poll.status = "completed";
    }
  }

  return {
    polls,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getAllPolls = async (query: Record<string, unknown>, scope?: { partnerId?: string; stationId?: string; role?: string }) => {
  const filter: Record<string, unknown> = {};

  if (scope?.role === "station_admin" && scope.stationId) {
    filter.station = scope.stationId;
  } else if (scope?.role === "partner_admin" && scope.partnerId) {
    const partnerStations = await StationRepository.findAll({ partner: scope.partnerId }, { limit: 1000 });
    filter.station = { $in: partnerStations.map((s: any) => s._id) };
  }

  if (query.station) filter.station = query.station;
  if (query.status) filter.status = query.status;

  if (query.search) {
    const escaped = (query.search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.question = new RegExp(escaped, "i");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [polls, total] = await Promise.all([
    PollRepository.findAll(filter, { skip, limit }),
    PollRepository.count(filter),
  ]);

  // Auto-complete expired polls
  const now = new Date();
  for (const poll of polls) {
    if (poll.status === "active" && poll.expiresAt && new Date(poll.expiresAt) <= now) {
      await PollRepository.updateById(poll._id.toString(), { status: "completed" });
      poll.status = "completed";
    }
  }

  return {
    polls,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getPollById = async (id: string) => {
  const poll = await PollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  return poll;
};

const votePoll = async (pollId: string, optionIndex: number, userId: string) => {
  const poll = await PollRepository.findById(pollId);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  if (poll.status !== "active") {
    throw new AppError(StatusCodes.BAD_REQUEST, "This poll is not active.");
  }
  if (optionIndex < 0 || optionIndex >= poll.options.length) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid option index.");
  }

  const alreadyVoted = await PollRepository.hasVoted(pollId, userId);
  if (alreadyVoted) {
    throw new AppError(StatusCodes.CONFLICT, "You have already voted in this poll.");
  }

  const updated = await PollRepository.vote(pollId, optionIndex, userId);
  if (!updated || (updated as any).alreadyVoted) {
    throw new AppError(StatusCodes.CONFLICT, "You have already voted in this poll.");
  }

  try {
    emitToStation((poll as any).station.toString(), "poll-updated", { poll: updated });
  } catch {}

  return updated;
};

const updatePoll = async (id: string, updates: { question?: string; status?: string }) => {
  const poll = await PollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  return PollRepository.updateById(id, updates);
};

const deletePoll = async (id: string) => {
  const poll = await PollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  await PollRepository.deleteById(id);
  // Clean up votes (best-effort, non-blocking)
  try {
    await PollRepository.deleteVotesByPoll(id);
  } catch {}
};

export const PollService = {
  createPoll,
  getStationPolls,
  getAllPolls,
  getPollById,
  votePoll,
  updatePoll,
  deletePoll,
};
