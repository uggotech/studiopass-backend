import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ChallengeRepository } from "./challenge.repository";
import { StationRepository } from "../station/station.repository";
import { ChallengeParticipationRepository } from "../challengeParticipation/challengeParticipation.repository";
import { DisbursementRepository } from "../disbursement/disbursement.repository";
import { CreditService } from "../credit/credit.service";
import { emitToStation } from "../../socket";
import { normalizeHhMm, zonedDateTimeToUtc } from "./challengeTime";

/** Strip isCorrect from challenge questions so app users cannot cheat. */
function stripCorrectAnswers(challenge: any) {
  if (!challenge?.questions) return challenge;
  const stripped = { ...challenge };
  stripped.questions = challenge.questions.map((q: any) => ({
    ...q,
    options: q.options.map((o: any) => {
      const { isCorrect, ...rest } = o;
      return rest;
    }),
  }));
  return stripped;
}

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

  let timezone = "UTC";
  try {
    const countryId =
      typeof station.country === "object" && station.country !== null
        ? (station.country as any)._id || station.country
        : station.country;
    if (countryId) {
      const { Country } = await import("../country/country.model");
      const countryDoc: any = await Country.findById(countryId)
        .select("timezone")
        .lean();
      if (countryDoc?.timezone) timezone = countryDoc.timezone;
    }
  } catch {
    timezone = "UTC";
  }

  const startTime = normalizeHhMm(data.startTime);
  const endTime = normalizeHhMm(data.endTime);
  // Station-country local wall clock → exact UTC (same model as channel polls)
  const startsAt = zonedDateTimeToUtc(data.startDate, startTime, timezone);
  const endsAt = zonedDateTimeToUtc(data.endDate, endTime, timezone);

  if (endsAt <= startsAt) {
    throw new AppError(StatusCodes.BAD_REQUEST, "End time must be after start time.");
  }

  const now = new Date();
  const resolvedStatus =
    data.status ||
    (startsAt > now ? "scheduled" : endsAt <= now ? "completed" : "active");

  const challenge = await ChallengeRepository.create({
    station: stationId,
    title: data.title,
    type: data.type,
    description: data.description,
    instructions: data.instructions,
    startDate: startsAt,
    startTime,
    endDate: endsAt,
    endTime,
    startsAt,
    endsAt,
    questions: data.questions,
    status: resolvedStatus,
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

  // Status transitions are owned by challengeScheduler (station TZ / startsAt-endsAt).
  // Do not auto-complete here — setHours used server clock and skipped disbursements.

  return {
    challenges,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getAllChallenges = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string; role?: string; userId?: string },
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

  // Listeners should never see drafts/cancelled unless they explicitly ask
  if (scope?.role === "user" && !query.status) {
    filter.status = { $in: ["scheduled", "active", "completed"] };
  }

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

  // Strip isCorrect for app users to prevent cheating
  const isAppUser = scope?.role === "user";
  let result = isAppUser ? challenges.map(stripCorrectAnswers) : challenges;

  // Attach hasParticipated for listeners (one batched query)
  if (isAppUser && scope?.userId && result.length > 0) {
    const ids = result.map((c: any) => c._id);
    const parts = await ChallengeParticipationRepository.findByUserAndChallenges(scope.userId, ids);
    const played = new Set(parts.map((p: any) => String(p.challenge)));
    result = result.map((c: any) => ({
      ...c,
      hasParticipated: played.has(String(c._id)),
    }));
  }

  return {
    challenges: result,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getChallengeById = async (id: string, userRole?: string) => {
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }
  return userRole === "user" ? stripCorrectAnswers(challenge) : challenge;
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

    // Belt-and-suspenders: exact UTC window when present (station-local converted at create)
    const nowCheck = new Date();
    if (challenge.startsAt && nowCheck < new Date(challenge.startsAt)) {
      throw new AppError(StatusCodes.BAD_REQUEST, "This challenge has not started yet.");
    }
    if (challenge.endsAt && nowCheck >= new Date(challenge.endsAt)) {
      throw new AppError(StatusCodes.BAD_REQUEST, "This challenge has ended.");
    }

    // Check if user already participated inside transaction
    const existing = await ChallengeParticipationRepository.findByChallengeAndUser(challengeId, userId);
    if (existing) {
      throw new AppError(StatusCodes.CONFLICT, "You have already participated in this challenge.");
    }

    // All types may have multiple questions — require a complete set before charging
    const questionCount = challenge.questions?.length || 0;
    if (questionCount < 1) {
      throw new AppError(StatusCodes.BAD_REQUEST, "This challenge has no questions.");
    }
    const answeredIndexes = new Set(answers.map((a) => a.questionIndex));
    for (let i = 0; i < questionCount; i++) {
      if (!answeredIndexes.has(i)) {
        throw new AppError(
          StatusCodes.BAD_REQUEST,
          "Please answer all questions before submitting.",
        );
      }
      const question = challenge.questions[i];
      const selected = answers.find((a) => a.questionIndex === i)?.selectedOption;
      if (selected == null || !question?.options?.[selected]) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Invalid answer selected.");
      }
    }

    // Check billing — only after complete answers so incomplete play is never charged
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

    // Calculate score: +1 per correct (default); no custom per-question points yet
    let score = 0;
    let correctCount = 0;
    const evaluatedAnswers = answers.map((answer) => {
      const question = challenge.questions[answer.questionIndex];
      if (!question) return { ...answer, isCorrect: false };
      const isCorrect = question.options[answer.selectedOption]?.isCorrect || false;
      if (isCorrect) {
        score++;
        correctCount++;
      }
      return { ...answer, isCorrect };
    });

    // Speed bonus only for a perfect fastest_answer run — never on wrong answers
    if (
      challenge.type === "fastest_answer" &&
      timeTaken > 0 &&
      correctCount === questionCount
    ) {
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

  // Exact rank: better score, or same score with faster time
  let rank: number | null = null;
  if (participation) {
    const better = await ChallengeParticipationRepository.countBetterThan(
      challengeId,
      participation.score,
      participation.timeTaken,
    );
    rank = better + 1;
  }

  let isWinner = false;
  let disbursementStatus: string | null = null;
  let prizeLabel: string | null = challenge.prizeLabel || null;
  let prizeValue: string | null = challenge.prizeValue || null;
  let anyDisbursement = false;
  try {
    const { Disbursement } = await import("../disbursement/disbursement.model");
    const [disb, disbCount] = await Promise.all([
      Disbursement.findOne({
        challenge: challengeId,
        winnerUser: userId,
      })
        .select("status prizeLabel prizeValue")
        .lean(),
      Disbursement.countDocuments({ challenge: challengeId }),
    ]);
    anyDisbursement = disbCount > 0;
    if (disb) {
      isWinner = true;
      disbursementStatus = disb.status || "pending";
      prizeLabel = disb.prizeLabel || prizeLabel;
      prizeValue = disb.prizeValue || prizeValue;
    }
  } catch {
    // disbursement lookup optional
  }

  // completed + no payout rows yet → winners still being processed (scheduler lag)
  const resultsFinalized =
    challenge.status === "completed" &&
    (anyDisbursement || !challenge.totalParticipants);

  return {
    challenge: {
      id: challenge._id,
      title: challenge.title,
      type: challenge.type,
      description: challenge.description,
      instructions: challenge.instructions,
      rewardText: challenge.rewardText,
      prizeLabel,
      prizeValue,
      prizeTypeKey: challenge.prizeTypeKey,
      currency: challenge.currency,
      numberOfWinners: challenge.numberOfWinners || 1,
      status: challenge.status,
      station: challenge.station,
      maxScore: challenge.questions?.length || 0,
      questionCount: challenge.questions?.length || 0,
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
    rank,
    isWinner,
    disbursementStatus,
    resultsFinalized,
  };
};

const getMyParticipations = async (
  userId: string,
  page = 1,
  limit = 20,
) => {
  const p = Math.max(1, page);
  const l = Math.max(1, Math.min(50, limit));
  const skip = (p - 1) * l;

  const [rows, total] = await Promise.all([
    ChallengeParticipationRepository.findByUser(userId, skip, l),
    ChallengeParticipationRepository.countByUser(userId),
  ]);

  const { Disbursement } = await import("../disbursement/disbursement.model");
  const challengeIds = rows.map((r: any) => r.challenge?._id || r.challenge).filter(Boolean);
  const disbs = challengeIds.length
    ? await Disbursement.find({
        winnerUser: userId,
        challenge: { $in: challengeIds },
      })
        .select("challenge status prizeLabel prizeValue")
        .lean()
    : [];
  const disbByChallenge = new Map(
    disbs.map((d: any) => [String(d.challenge), d]),
  );

  const items = rows.map((row: any) => {
    const ch = row.challenge;
    const chId = String(ch?._id || row.challenge);
    const disb = disbByChallenge.get(chId);
    return {
      participationId: row._id,
      score: row.score,
      timeTaken: row.timeTaken,
      submittedAt: row.submittedAt,
      challenge: ch
        ? {
            id: ch._id,
            title: ch.title,
            type: ch.type,
            description: ch.description,
            instructions: ch.instructions,
            status: ch.status,
            prizeLabel: disb?.prizeLabel || ch.prizeLabel,
            prizeValue: disb?.prizeValue || ch.prizeValue,
            prizeTypeKey: ch.prizeTypeKey,
            currency: ch.currency,
            numberOfWinners: ch.numberOfWinners || 1,
            rewardText: ch.rewardText,
            billingMode: ch.billingMode,
            creditCost: ch.creditCost,
            station: ch.station,
            startsAt: ch.startsAt || ch.startDate,
            endsAt: ch.endsAt || ch.endDate,
          }
        : null,
      isWinner: !!disb,
      disbursementStatus: disb?.status || null,
    };
  });

  // Won first, then newest
  items.sort((a: any, b: any) => {
    if (a.isWinner != b.isWinner) return a.isWinner ? -1 : 1;
    return (b.submittedAt?.getTime?.() || 0) - (a.submittedAt?.getTime?.() || 0);
  });

  return {
    items,
    meta: {
      page: p,
      limit: l,
      total,
      totalPage: Math.ceil(total / l),
    },
  };
};

const updateChallenge = async (id: string, updates: Record<string, unknown>) => {
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) {
    throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  }

  // Prevent editing questions on active/completed/cancelled challenges
  if (updates.questions && ["active", "completed", "cancelled"].includes(challenge.status)) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Cannot edit questions on an active, completed, or cancelled challenge. Cancel the challenge first.",
    );
  }

  // Convert date strings to Date objects if provided
  if (updates.startDate) {
    updates.startDate = new Date(updates.startDate as string);
  }
  if (updates.endDate) {
    updates.endDate = new Date(updates.endDate as string);
  }

  // Recompute UTC instants when wall-clock fields change (station country TZ)
  const touchStart =
    updates.startDate !== undefined ||
    updates.startTime !== undefined ||
    updates.startsAt !== undefined;
  const touchEnd =
    updates.endDate !== undefined ||
    updates.endTime !== undefined ||
    updates.endsAt !== undefined;

  if (touchStart || touchEnd) {
    let timezone = "UTC";
    try {
      const station: any = await StationRepository.findById(
        (challenge.station as any)?.toString?.() || challenge.station,
      );
      const countryId =
        typeof station?.country === "object" && station?.country !== null
          ? station.country._id || station.country
          : station?.country;
      if (countryId) {
        const { Country } = await import("../country/country.model");
        const countryDoc: any = await Country.findById(countryId)
          .select("timezone")
          .lean();
        if (countryDoc?.timezone) timezone = countryDoc.timezone;
      }
    } catch {
      timezone = "UTC";
    }

    const startDateInput =
      updates.startDate !== undefined
        ? (updates.startDate as Date)
        : challenge.startDate;
    const endDateInput =
      updates.endDate !== undefined ? (updates.endDate as Date) : challenge.endDate;
    const startTime =
      updates.startTime !== undefined
        ? normalizeHhMm(updates.startTime as string)
        : normalizeHhMm(challenge.startTime);
    const endTime =
      updates.endTime !== undefined
        ? normalizeHhMm(updates.endTime as string)
        : normalizeHhMm(challenge.endTime);

    updates.startTime = startTime;
    updates.endTime = endTime;

    if (touchStart && updates.startsAt === undefined) {
      const dateStr = toDateInputString(startDateInput, timezone);
      updates.startsAt = zonedDateTimeToUtc(dateStr, startTime, timezone);
      updates.startDate = updates.startsAt;
    }
    if (touchEnd && updates.endsAt === undefined) {
      const dateStr = toDateInputString(endDateInput, timezone);
      updates.endsAt = zonedDateTimeToUtc(dateStr, endTime, timezone);
      updates.endDate = updates.endsAt;
    }
  }

  return ChallengeRepository.updateById(id, updates);
};

function toDateInputString(d: Date | string, timeZone: string): string {
  if (typeof d === "string") {
    return d.slice(0, 10);
  }
  const date = d instanceof Date ? d : new Date(d as string);
  if (Number.isNaN(date.getTime())) return String(d).slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

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
  // Clean up disbursements (best-effort)
  try {
    await DisbursementRepository.deleteByChallenge(id);
  } catch {}
};

const getChallengeStats = async (
  scope?: { partnerId?: string; stationId?: string; role?: string },
) => {
  const filter: Record<string, unknown> = {};

  if (scope?.role === "station_admin" && scope.stationId) {
    filter.station = new mongoose.Types.ObjectId(scope.stationId);
  } else if (scope?.role === "partner_admin" && scope.partnerId) {
    const partnerStations = await StationRepository.findAll({ partner: scope.partnerId }, { limit: 1000 });
    filter.station = { $in: partnerStations.map((s: any) => s._id) };
  }

  const result = await ChallengeRepository.getStats(filter);
  return result[0] || {
    total: 0,
    active: 0,
    completed: 0,
    scheduled: 0,
    draft: 0,
    cancelled: 0,
    totalParticipants: 0,
  };
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
  // Atomic find-and-update to prevent double-refund race condition
  const updated = await ChallengeRepository.updateByIdConditional(id, { status: "cancelled" });

  if (!updated) {
    const existing = await ChallengeRepository.findById(id);
    if (!existing) throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
    throw new AppError(StatusCodes.BAD_REQUEST, `Cannot cancel challenge in status ${existing.status}`);
  }

  if (updated.billingMode === "credits" && updated.creditCost > 0) {
    try {
      const participations = await ChallengeParticipationRepository.findByChallengeIdSorted(id);
      for (const p of participations) {
        const userIdStr = (p.user as any).toString();
        const stationIdStr = (updated.station as any).toString();
        await CreditService.refundCredits(
          userIdStr,
          updated.creditCost,
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
  getMyParticipations,
  getChallengeStats,
  getAdminLeaderboard,
  updateChallenge,
  cancelChallenge,
  deleteChallenge,
};
