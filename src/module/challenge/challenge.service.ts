import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ChallengeRepository } from "./challenge.repository";
import { StationRepository } from "../station/station.repository";
import { ChallengeParticipationRepository } from "../challengeParticipation/challengeParticipation.repository";
import { CreditService } from "../credit/credit.service";
import { emitToStation } from "../../socket";

const createChallenge = async (
  stationId: string,
  data: {
    title: string;
    type: string;
    description: string;
    instructions?: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    questions: { text: string; options: { label: string; isCorrect: boolean }[]; timeLimit?: number }[];
    status?: string;
    billingMode?: string;
    creditCost?: number;
    rewardText?: string;
    prizeType?: string;
    prizeTypeKey?: string;
    prizeLabel?: string;
    prizeValue?: string;
    currency?: string;
    numberOfWinners?: number;
    sponsorName?: string;
    collectionInstructions?: string;
  },
  createdBy: string,
  userRole?: string,
) => {
  const station: any = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  if (station.category === "channel") {
    if (userRole && !["super_admin", "partner_admin"].includes(userRole)) {
      throw new AppError(
        StatusCodes.FORBIDDEN,
        "Only Super Admin and Partner Admin can create challenges for Channels.",
      );
    }
  }

  const currency = data.currency || station.country?.currency || "UGX";

  const challenge = await ChallengeRepository.create({
    station: stationId,
    title: data.title,
    type: data.type,
    description: data.description,
    instructions: data.instructions,
    startDate: new Date(data.startDate),
    startTime: data.startTime,
    endDate: new Date(data.endDate),
    endTime: data.endTime,
    questions: data.questions,
    status: data.status || "scheduled",
    billingMode: data.billingMode || "free",
    creditCost: data.creditCost || 1,
    totalParticipants: 0,
    rewardText: data.rewardText || "",
    prizeType: data.prizeType,
    prizeTypeKey: data.prizeTypeKey,
    prizeLabel: data.prizeLabel,
    prizeValue: data.prizeValue,
    currency,
    numberOfWinners: data.numberOfWinners || 1,
    sponsorName: data.sponsorName,
    collectionInstructions: data.collectionInstructions,
    createdBy,
  });

  return challenge;
};

const getStationChallenges = async (
  stationId: string,
  page: number,
  limit: number,
  status?: string,
) => {
  const skip = (page - 1) * limit;
  const [challenges, total] = await Promise.all([
    ChallengeRepository.findByStation(stationId, skip, limit, status),
    ChallengeRepository.countByStation(stationId, status),
  ]);

  // Auto-complete expired challenges
  const now = new Date();
  for (const challenge of challenges) {
    if (challenge.status === "active") {
      const endDateTime = new Date(challenge.endDate);
      const timeParts = challenge.endTime.split(":").map(Number);
      const hours = timeParts[0] ?? 0;
      const minutes = timeParts[1] ?? 0;
      endDateTime.setHours(hours, minutes, 0, 0);
      if (endDateTime <= now) {
        await ChallengeRepository.updateById(challenge._id.toString(), { status: "completed" });
        challenge.status = "completed";
      }
    }
  }

  return {
    challenges,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getAllChallenges = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string; role?: string },
) => {
  const filter: Record<string, unknown> = {};

  if (scope?.role === "station_admin" && scope.stationId) {
    filter.station = scope.stationId;
  } else if (scope?.role === "partner_admin" && scope.partnerId) {
    const partnerStations = await StationRepository.findAll({ partner: scope.partnerId }, { limit: 1000 });
    filter.station = { $in: partnerStations.map((s: any) => s._id) };
  }

  if (query.station) filter.station = query.station;
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;

  if (query.search) {
    const escaped = (query.search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.title = new RegExp(escaped, "i");
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [challenges, total] = await Promise.all([
    ChallengeRepository.findAll(filter, { skip, limit }),
    ChallengeRepository.count(filter),
  ]);

  return {
    challenges,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getChallengeById = async (id: string) => {
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }
  return challenge;
};

const participateInChallenge = async (
  challengeId: string,
  userId: string,
  answers: { questionIndex: number; selectedOption: number }[],
  timeTaken: number,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const challenge = await ChallengeRepository.findById(challengeId);
    if (!challenge) {
      throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
    }

    if (challenge.status !== "active") {
      throw new AppError(StatusCodes.BAD_REQUEST, "This challenge is not active.");
    }

    // Check if user already participated inside transaction
    const existing = await ChallengeParticipationRepository.findByChallengeAndUser(challengeId, userId);
    if (existing) {
      throw new AppError(StatusCodes.CONFLICT, "You have already participated in this challenge.");
    }

    // Check billing
    if (challenge.billingMode === "credits" && challenge.creditCost > 0) {
      await CreditService.deductCredits(
        userId,
        challenge.creditCost,
        challenge.station.toString(),
        challengeId,
        "challenge",
        session,
      );
    }

    // Calculate score
    let score = 0;
    const evaluatedAnswers = answers.map((answer) => {
      const question = challenge.questions[answer.questionIndex];
      if (!question) return { ...answer, isCorrect: false };
      const isCorrect = question.options[answer.selectedOption]?.isCorrect || false;
      if (isCorrect) score++;
      return { ...answer, isCorrect };
    });

    // Bonus for speed (fastest_answer type)
    if (challenge.type === "fastest_answer" && timeTaken > 0) {
      const speedBonus = Math.max(0, 5 - Math.floor(timeTaken / 10));
      score += speedBonus;
    }

    const participation = await ChallengeParticipationRepository.create({
      challenge: challengeId,
      user: userId,
      answers: evaluatedAnswers,
      score,
      timeTaken,
      submittedAt: new Date(),
    });

    // Increment participant count
    await ChallengeRepository.incrementParticipants(challengeId);

    await session.commitTransaction();

    // Emit socket event
    try {
      emitToStation(challenge.station.toString(), "challenge-participation", {
        challengeId,
        userId,
        score,
      });
    } catch {}

    return participation;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const getChallengeResult = async (challengeId: string, userId: string) => {
  const challenge = await ChallengeRepository.findById(challengeId);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }

  const participation = await ChallengeParticipationRepository.findByChallengeAndUser(challengeId, userId);
  const leaderboard = await ChallengeParticipationRepository.getLeaderboard(challengeId, 10);

  return {
    challenge: {
      id: challenge._id,
      title: challenge.title,
      type: challenge.type,
      rewardText: challenge.rewardText,
      status: challenge.status,
    },
    participation: participation
      ? {
          score: participation.score,
          timeTaken: participation.timeTaken,
          submittedAt: participation.submittedAt,
          correctAnswers: participation.answers.filter((a: any) => a.isCorrect).length,
        }
      : null,
    leaderboard,
  };
};

const updateChallenge = async (id: string, updates: Record<string, unknown>) => {
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }
  return ChallengeRepository.updateById(id, updates);
};

const deleteChallenge = async (id: string) => {
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }
  await ChallengeRepository.deleteById(id);
  // Clean up participations (best-effort)
  try {
    await ChallengeParticipationRepository.deleteByChallenge(id);
  } catch {}
};

const getAdminLeaderboard = async (challengeId: string, page: number = 1, limit: number = 50) => {
  const challenge = await ChallengeRepository.findById(challengeId);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }

  const skip = (page - 1) * limit;
  const [participations, total] = await Promise.all([
    ChallengeParticipationRepository.getAdminLeaderboard(challengeId, skip, limit),
    ChallengeParticipationRepository.countByChallenge(challengeId),
  ]);

  return {
    challenge: {
      id: challenge._id,
      title: challenge.title,
      type: challenge.type,
      prizeLabel: challenge.prizeLabel,
      prizeValue: challenge.prizeValue,
      currency: challenge.currency,
      numberOfWinners: challenge.numberOfWinners || 1,
      status: challenge.status,
    },
    leaderboard: participations,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const cancelChallenge = async (id: string) => {
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }

  if (challenge.status === "completed" || challenge.status === "cancelled") {
    throw new AppError(StatusCodes.BAD_REQUEST, `Cannot cancel challenge in status ${challenge.status}`);
  }

  const updated = await ChallengeRepository.updateById(id, { status: "cancelled" });

  if (challenge.billingMode === "credits" && challenge.creditCost > 0) {
    try {
      const participations = await ChallengeParticipationRepository.findByChallengeIdSorted(id);
      for (const p of participations) {
        const userIdStr = (p.user as any).toString();
        const stationIdStr = (challenge.station as any).toString();
        await CreditService.refundCredits(
          userIdStr,
          challenge.creditCost,
          stationIdStr,
          id,
          "challenge",
        );
      }
    } catch (err) {
      console.error("[Challenge] Error refunding credits for cancelled challenge:", err);
    }
  }

  return updated;
};

export const ChallengeService = {
  createChallenge,
  getStationChallenges,
  getAllChallenges,
  getChallengeById,
  participateInChallenge,
  getChallengeResult,
  getAdminLeaderboard,
  updateChallenge,
  cancelChallenge,
  deleteChallenge,
};
