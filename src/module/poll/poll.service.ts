import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { PollRepository } from "./poll.repository";
import { StationRepository } from "../station/station.repository";
import { emitToStation } from "../../socket";

type PollScope = { role?: string; stationId?: string; partnerId?: string };

const stationIdOf = (poll: any): string => String(poll?.station?._id ?? poll?.station ?? "");

/**
 * A station admin / media station only reaches polls of their own station; a partner admin only polls of their
 * partner's stations. Anything else answers "not found" (never reveals that the poll exists). Listeners and
 * super admins are not scoped.
 */
const assertPollInScope = async (poll: any, scope?: PollScope) => {
  if (!scope?.role) return;
  if (scope.role === "station_admin" || scope.role === "media_station") {
    if (!scope.stationId || stationIdOf(poll) !== String(scope.stationId)) {
      throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
    }
    return;
  }
  if (scope.role === "partner_admin" && scope.partnerId) {
    const station: any = await StationRepository.findById(stationIdOf(poll));
    const stationPartnerId = station?.partner?._id || station?.partner?.id || station?.partner;
    if (!station || String(stationPartnerId) !== String(scope.partnerId)) {
      throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
    }
  }
};

const createPoll = async (
  stationId: string,
  question: string,
  options: Array<string | { label: string; imageUrl?: string | null }>,
  createdBy: string,
  showId?: string,
  expiresAt?: string,
  userRole?: string,
  userPartnerId?: string,
) => {
  const station: any = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  // Quick show polls are for Radio and TV. A Channel has no shows: it runs channel polls (nominees and categories).
  if (station.category === "channel") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Quick polls are for Radio and TV stations. A Channel uses channel polls instead.",
    );
  }

  if (userRole === "partner_admin" && userPartnerId) {
    const stationPartnerId = station.partner?._id || station.partner?.id || station.partner;
    if (stationPartnerId?.toString() !== userPartnerId) {
      throw new AppError(StatusCodes.FORBIDDEN, "Unauthorized to create polls for stations outside your country partner.");
    }
  }

  const formattedOptions = options.map((opt) => {
    if (typeof opt === "string") {
      return { label: opt, imageUrl: null, votes: 0 };
    }
    return { label: opt.label, imageUrl: opt.imageUrl || null, votes: 0 };
  });

  const poll = await PollRepository.create({
    station: stationId,
    show: showId || undefined,
    question,
    options: formattedOptions,
    status: "active",
    createdBy,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });

  try {
    emitToStation(stationId, "new-poll", { poll });
  } catch {}

  return poll;
};

const getStationPolls = async (stationId: string, page: number, limit: number, status?: string, userId?: string) => {
  const skip = (page - 1) * limit;
  const [polls, total] = await Promise.all([
    PollRepository.findByStation(stationId, skip, limit, status, userId),
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

const getAllPolls = async (query: Record<string, unknown>, scope?: { partnerId?: string; stationId?: string; role?: string }, userId?: string) => {
  const filter: Record<string, unknown> = {};

  if (scope?.role === "station_admin" || scope?.role === "media_station") {
    // Own station only, whatever the request asks for (a Media Station used to see every station's polls)
    filter.station = scope.stationId || "000000000000000000000000";
  } else if (query.station) {
    filter.station = query.station;
  } else if (scope?.role === "partner_admin" && scope.partnerId) {
    const partnerStations = await StationRepository.findAll({ partner: scope.partnerId }, { limit: 1000 });
    filter.station = { $in: partnerStations.map((s: any) => s._id) };
  }

  if (query.status) filter.status = query.status;

  if (query.search) {
    const escaped = (query.search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.question = new RegExp(escaped, "i");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [polls, total] = await Promise.all([
    PollRepository.findAll(filter, { skip, limit }, userId),
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

const getPollById = async (id: string, userId?: string, scope?: PollScope) => {
  const poll = await PollRepository.findById(id, userId);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  await assertPollInScope(poll, scope);
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
    // findById populates the station: use its id, not the object (which emitted to "station:[object Object]")
    emitToStation(String((poll as any).station?._id ?? (poll as any).station), "poll-updated", { poll: updated });
  } catch {}

  // Return updated poll with isVotedByMe = true
  return { ...updated, isVotedByMe: true };
};

const updatePoll = async (id: string, updates: { question?: string; status?: string }, scope?: PollScope) => {
  const poll = await PollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  await assertPollInScope(poll, scope);
  return PollRepository.updateById(id, updates);
};

const deletePoll = async (id: string, scope?: PollScope) => {
  const poll = await PollRepository.findById(id);
  if (!poll) {
    throw new AppError(StatusCodes.NOT_FOUND, "Poll not found");
  }
  await assertPollInScope(poll, scope);
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
