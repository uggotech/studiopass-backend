import mongoose from "mongoose";
import { DisbursementRepository } from "./disbursement.repository";
import { Challenge } from "../challenge/challenge.model";
import { ChallengeParticipationRepository } from "../challengeParticipation/challengeParticipation.repository";
import { User } from "../user/user.model";
import { CreditService } from "../credit/credit.service";
import { NotificationService } from "../notification/notification.service";
import { logger } from "../../logger/logger";

const createDisbursementsForChallenge = async (challengeId: string): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const challenge = await Challenge.findById(challengeId).session(session).lean();
    if (!challenge) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    const numberOfWinners = challenge.numberOfWinners || 1;
    const participations = await ChallengeParticipationRepository.findByChallengeIdSorted(challengeId);

    if (!participations || participations.length === 0) {
      logger.info(`[Disbursement] No participations found for challenge ${challengeId}`);
      await session.abortTransaction();
      session.endSession();
      return;
    }

    // Atomic idempotency & station balance check: verify station and existing disbursements
    const { Disbursement } = await import("./disbursement.model");
    const { Station } = await import("../station/station.model");

    const [existingCount, stationDoc] = await Promise.all([
      Disbursement.countDocuments({ challenge: challenge._id }).session(session),
      Station.findById(challenge.station).session(session).lean(),
    ]);

    if (existingCount > 0) {
      logger.info(`[Disbursement] Disbursements already created for challenge ${challengeId}`);
      await session.abortTransaction();
      session.endSession();
      return;
    }

    if (!stationDoc || stationDoc.isActive === false) {
      logger.error(`[Disbursement] Inactive or missing station ${challenge.station} for challenge ${challengeId}`);
      await session.abortTransaction();
      session.endSession();
      return;
    }

    const winnerCount = Math.min(numberOfWinners, participations.length);
    const winners = participations.slice(0, winnerCount);
    const nonWinners = participations.slice(winnerCount);

    const prizeLabel = challenge.prizeLabel || challenge.prizeTypeKey || "Reward";
    const prizeValueStr = challenge.currency
      ? `${challenge.currency} ${challenge.prizeValue}`
      : `${challenge.prizeValue}`;

    for (const winner of winners) {
      const userIdStr = String(winner.user);
      const user = await User.findById(userIdStr).lean();
      const winnerName = user?.fullName || "Participant";
      const phone = user?.phone || "";

      let status: "pending" | "successful" | "failed" = "pending";
      const txRef = `DISB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      if (challenge.prizeTypeKey === "bonus_credits") {
        const creditAmount = Number(challenge.prizeValue) || 0;
        if (creditAmount > 0) {
          try {
            await CreditService.rewardChallengeWinner(
              userIdStr,
              creditAmount,
              String(challenge.station),
              challengeId,
            );
            status = "successful";
          } catch (err) {
            logger.error(`[Disbursement] Credit grant error for user ${userIdStr}:`, err);
            status = "failed";
          }
        }
      } else if (["mobile_money", "airtime", "data_bundles"].includes(challenge.prizeTypeKey || "")) {
        status = "successful";
      } else {
        status = "successful";
      }

      await DisbursementRepository.create({
        challenge: challenge._id,
        winnerUser: winner.user as any,
        winnerName,
        phone,
        station: challenge.station as any,
        prizeTypeKey: challenge.prizeTypeKey || "other",
        prizeLabel,
        prizeValue: prizeValueStr,
        txRef,
        status,
        processedAt: new Date(),
      });

      const isPhysical = ["merchandise_tshirt", "merchandise_hoodie", "merchandise_cap", "external_gift", "other"].includes(
        challenge.prizeTypeKey || "",
      );

      const winnerTitle = "🎉 Congratulations! You Won!";
      const winnerMessage = isPhysical
        ? `🎉 Congratulations! You have won a ${challenge.prizeLabel || "prize"} in ${challenge.title}. Please contact station to collect your prize.`
        : `🎉 Congratulations! You have won ${prizeValueStr} in ${challenge.title}. Your reward has been successfully processed.`;

      await NotificationService.createNotification({
        userId: userIdStr,
        title: winnerTitle,
        body: winnerMessage,
        type: "system",
        data: { challengeId, type: "challenge_winner" },
      });
    }

    for (const nonWinner of nonWinners) {
      const userIdStr = String(nonWinner.user);
      await NotificationService.createNotification({
        userId: userIdStr,
        title: "Challenge Completed",
        body: `Thank you for participating in ${challenge.title}. Unfortunately, you were not among the winners this time. Keep participating in future challenges!`,
        type: "system",
        data: { challengeId, type: "challenge_result" },
      });
    }
    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error(`[Disbursement] Error creating disbursements for challenge ${challengeId}:`, error);
  }
};

const getDisbursements = async (
  query: Record<string, unknown>,
  _scope?: { partnerId?: string; countryId?: string },
) => {
  const filter: Record<string, unknown> = {};

  if (_scope?.partnerId || _scope?.countryId) {
    const { Station } = await import("../station/station.model");
    const stationFilter: Record<string, unknown> = {};
    if (_scope.partnerId) stationFilter.partner = _scope.partnerId;
    if (_scope.countryId) stationFilter.country = _scope.countryId;
    const scopedStations = await Station.find(stationFilter).select("_id").lean();
    const scopedStationIds = scopedStations.map((s) => s._id);

    if (query.station) {
      filter.station = scopedStationIds.some((id) => String(id) === String(query.station))
        ? query.station
        : { $in: [] };
    } else {
      filter.station = { $in: scopedStationIds };
    }
  } else if (query.station) {
    filter.station = query.station;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.search) {
    const searchRegex = new RegExp((query.search as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { winnerName: searchRegex },
      { phone: searchRegex },
      { prizeLabel: searchRegex },
      { txRef: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    DisbursementRepository.findWithPagination(filter, { skip, limit }),
    DisbursementRepository.count(filter),
  ]);

  return {
    disbursements: items,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

export const DisbursementService = {
  createDisbursementsForChallenge,
  getDisbursements,
};
