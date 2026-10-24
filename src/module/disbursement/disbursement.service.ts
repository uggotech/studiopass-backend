import crypto from "crypto";
import mongoose from "mongoose";
import { Disbursement } from "./disbursement.model";
import { TDisbursement } from "./disbursement.interface";
import { DisbursementRepository } from "./disbursement.repository";
import { Challenge } from "../challenge/challenge.model";
import { ChallengeParticipationRepository } from "../challengeParticipation/challengeParticipation.repository";
import { User } from "../user/user.model";
import { CreditService } from "../credit/credit.service";
import { NotificationService } from "../notification/notification.service";
import { logger } from "../../logger/logger";
import { sendAirtime } from "../../util/africasTalkingAirtime";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import config from "../../config";
import { normalizeUgandaPhone } from "../../shared/telecom/ugandaPhone.util";
import {
  generateAirtelId,
  isAirtelDisbursementConfigured,
  initiateAirtelDisbursement,
  getAirtelDisbursementStatus,
} from "../payment/airtel.service";

const PHYSICAL_PRIZES = ["merchandise_tshirt", "merchandise_hoodie", "merchandise_cap", "external_gift", "other"];

const AIRTIME_RETRY_MIN_AGE_MS = 5 * 60 * 1000;

const newTxRef = () => `DISB-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

const parsePrizeAmount = (prizeValue: string) => Number(String(prizeValue).replace(/[^\d.]/g, "")) || 0;

const notifySafely = async (payload: Parameters<typeof NotificationService.createNotification>[0]) => {
  try {
    await NotificationService.createNotification(payload);
  } catch (err) {
    logger.warn(`[Disbursement] Notification failed for user ${payload.userId}:`, err);
  }
};

/**
 * Grants bonus credits and marks the row successful in ONE transaction,
 * claiming the row (pending -> successful) so a retry can never grant twice.
 */
const dispatchBonusCredits = async (row: TDisbursement, challengeId: string) => {
  const creditAmount = parsePrizeAmount(row.prizeValue);
  if (creditAmount <= 0) {
    await Disbursement.updateOne(
      { _id: row._id, status: "pending" },
      { $set: { status: "failed", failureReason: "Invalid bonus credit value", processedAt: new Date() } },
    );
    return;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const claimed = await Disbursement.findOneAndUpdate(
      { _id: row._id, status: "pending" },
      { $set: { status: "successful", processedAt: new Date() } },
      { session },
    );
    if (!claimed) {
      await session.abortTransaction();
      return;
    }
    await CreditService.rewardChallengeWinner(
      String(row.winnerUser),
      creditAmount,
      String(row.station),
      challengeId,
      session,
    );
    await session.commitTransaction();
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    logger.error(`[Disbursement] Credit grant error for user ${row.winnerUser}:`, err);
    await Disbursement.updateOne(
      { _id: row._id, status: "pending" },
      { $set: { status: "failed", failureReason: "Failed to grant bonus credits", processedAt: new Date() } },
    );
  } finally {
    await session.endSession();
  }
};

/**
 * Sends airtime for one row. The row is first claimed (pending -> processing) so it
 * is never sent twice; the stored txRef is reused as Africa's Talking idempotencyKey.
 * A row stuck in "processing" without providerRequestId means the send outcome is
 * unknown (crash/timeout mid-call) and needs manual review, never an automatic resend.
 */
const dispatchAirtime = async (row: TDisbursement, currency: string) => {
  const claimed = await Disbursement.findOneAndUpdate(
    { _id: row._id, status: "pending", providerRequestId: { $in: [null, ""] } },
    { $set: { status: "processing", processedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) return;

  const airtimeAmount = parsePrizeAmount(row.prizeValue);
  if (!row.phone || airtimeAmount <= 0) {
    await Disbursement.updateOne(
      { _id: row._id },
      {
        $set: {
          status: "failed",
          failureReason: !row.phone ? "User has no phone number on profile" : "Invalid airtime prize value",
        },
      },
    );
    return;
  }

  try {
    const atResult = await sendAirtime({
      phoneNumber: row.phone,
      amount: airtimeAmount,
      currencyCode: currency,
      idempotencyKey: claimed.txRef,
    });

    if (atResult.success) {
      await Disbursement.updateOne({ _id: row._id }, { $set: { providerRequestId: atResult.requestId } });
    } else {
      await Disbursement.updateOne(
        { _id: row._id },
        { $set: { status: "failed", failureReason: atResult.error || "Africa's Talking rejected airtime dispatch" } },
      );
    }
  } catch (err: any) {
    logger.error(`[Disbursement] Airtime dispatch error for row ${row._id}; left "processing" for manual review:`, err);
    await Disbursement.updateOne(
      { _id: row._id },
      {
        $set: {
          failureReason: `Dispatch outcome unknown: ${err.message || "exception"}. Check Africa's Talking before resending.`,
        },
      },
    );
  }
};

// ─── Mobile money prizes ────────────────────────────────────────────────────

const MOBILE_MONEY_RETRY_MIN_AGE_MS = 2 * 60 * 1000;
const MOBILE_MONEY_ENQUIRY_MIN_AGE_MS = 60 * 1000;

type PayoutRoute =
  | { kind: "send"; rail: "airtel_money"; msisdn: string }
  | { kind: "wait"; reason: string }
  | { kind: "reject"; reason: string };

/**
 * Picks the payout rail for a winner's phone. "wait" keeps the row pending so it is
 * paid automatically by the payout job once that rail's credentials are configured.
 */
const routeMobileMoneyPayout = (phone: string): PayoutRoute => {
  const info = normalizeUgandaPhone(phone);
  if (!info.isValid) return { kind: "reject", reason: "Winner phone is not a valid Uganda number" };
  if (info.carrier === "AIRTEL") {
    return isAirtelDisbursementConfigured()
      ? { kind: "send", rail: "airtel_money", msisdn: info.airtelMsisdn }
      : { kind: "wait", reason: "Waiting for Airtel Money payout activation" };
  }
  if (info.carrier === "MTN") {
    // TODO(PL-payout): MTN payouts via PayLeo B2C once True African shares the payout API
    return { kind: "wait", reason: "Waiting for MTN Mobile Money payout activation" };
  }
  return { kind: "reject", reason: `Mobile money payouts are not available for ${info.carrier} numbers` };
};

/** Start of today in Africa/Kampala (UTC+3, no DST) */
const startOfKampalaDay = () => {
  const offsetMs = 3 * 60 * 60 * 1000;
  const local = new Date(Date.now() + offsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMs);
};

const mobileMoneyPaidToday = async () => {
  const rows = await Disbursement.find({
    prizeTypeKey: "mobile_money",
    status: { $in: ["processing", "successful"] },
    processedAt: { $gte: startOfKampalaDay() },
  })
    .select("prizeValue")
    .lean();
  return rows.reduce((sum, r) => sum + parsePrizeAmount(r.prizeValue), 0);
};

const notifyMobileMoneyPaid = (row: Pick<TDisbursement, "winnerUser" | "prizeValue" | "challenge">) =>
  notifySafely({
    userId: String(row.winnerUser),
    title: "Prize sent",
    body: `Your mobile money prize of ${row.prizeValue} has been sent to your phone.`,
    type: "system",
    data: { kind: "challenge_result", challengeId: String(row.challenge) },
  });

/**
 * Pays one mobile money prize. The row is claimed (pending -> processing) and its
 * transaction id (txRef) recorded BEFORE the money is sent, so a crash or timeout is
 * resolved by asking the operator for that id's status, never by sending again.
 */
const dispatchMobileMoney = async (row: TDisbursement) => {
  const amount = parsePrizeAmount(row.prizeValue);
  const fail = (reason: string) =>
    Disbursement.updateOne(
      { _id: row._id, status: "pending" },
      { $set: { status: "failed", failureReason: reason, processedAt: new Date() } },
    );

  if (!row.phone) return fail("User has no phone number on profile");
  if (amount <= 0) return fail("Invalid mobile money prize value");
  if (amount > config.payout.max_per_winner_ugx) {
    return fail(`Prize exceeds the per-winner payout cap (${config.payout.max_per_winner_ugx} UGX)`);
  }

  const route = routeMobileMoneyPayout(row.phone);
  if (route.kind === "reject") return fail(route.reason);
  if (route.kind === "wait") {
    await Disbursement.updateOne({ _id: row._id, status: "pending" }, { $set: { failureReason: route.reason } });
    return;
  }

  if (config.payout.daily_limit_ugx > 0 && (await mobileMoneyPaidToday()) + amount > config.payout.daily_limit_ugx) {
    await Disbursement.updateOne(
      { _id: row._id, status: "pending" },
      { $set: { failureReason: "Daily payout limit reached; will retry automatically" } },
    );
    return;
  }

  const claimed = await Disbursement.findOneAndUpdate(
    { _id: row._id, status: "pending" },
    {
      $set: {
        status: "processing",
        provider: route.rail,
        providerRequestId: row.txRef,
        processedAt: new Date(),
        failureReason: null,
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!claimed || !claimed.txRef) return;

  const result = await initiateAirtelDisbursement({
    msisdn: route.msisdn,
    amount,
    transactionId: claimed.txRef,
  });

  if (result.state === "SUCCESS") {
    await Disbursement.updateOne(
      { _id: row._id, status: "processing" },
      { $set: { status: "successful", providerReference: result.airtelMoneyId } },
    );
    await notifyMobileMoneyPaid(claimed);
  } else if (result.state === "FAILED") {
    await Disbursement.updateOne(
      { _id: row._id, status: "processing" },
      { $set: { status: "failed", failureReason: result.message || "Airtel rejected the payout" } },
    );
  }
  // PENDING / UNKNOWN: stays "processing"; reconcileMobileMoneyPayouts resolves it via enquiry
};

/** Resolves in-flight mobile money payouts by asking the operator for their status. */
const reconcileMobileMoneyPayouts = async () => {
  const inFlight = await Disbursement.find({
    prizeTypeKey: "mobile_money",
    status: "processing",
    provider: "airtel_money",
    processedAt: { $lte: new Date(Date.now() - MOBILE_MONEY_ENQUIRY_MIN_AGE_MS) },
  })
    .limit(20)
    .lean();

  for (const row of inFlight) {
    if (!row.providerRequestId) continue;
    const status = await getAirtelDisbursementStatus(row.providerRequestId);
    if (status.state === "SUCCESS") {
      const res = await Disbursement.updateOne(
        { _id: row._id, status: "processing" },
        { $set: { status: "successful", providerReference: status.airtelMoneyId } },
      );
      if (res.modifiedCount) await notifyMobileMoneyPaid(row as unknown as TDisbursement);
    } else if (status.state === "FAILED") {
      await Disbursement.updateOne(
        { _id: row._id, status: "processing" },
        { $set: { status: "failed", failureReason: status.message || "Airtel payout failed" } },
      );
    }
  }
};

/**
 * Admin action: put a FAILED automated prize back in the payout queue
 * (e.g. after topping up the payout wallet or fixing the winner's phone).
 * A new transaction id is used because the old one is final at the operator.
 */
const retryDisbursement = async (id: string, scope?: { partnerId?: string; countryId?: string }) => {
  const row = await Disbursement.findById(id).lean();
  if (!row) throw new AppError(StatusCodes.NOT_FOUND, "Disbursement not found");
  if (scope?.partnerId || scope?.countryId) {
    const { Station } = await import("../station/station.model");
    const stationFilter: Record<string, unknown> = { _id: row.station };
    if (scope.partnerId) stationFilter.partner = scope.partnerId;
    if (scope.countryId) stationFilter.country = scope.countryId;
    if (!(await Station.exists(stationFilter))) {
      throw new AppError(StatusCodes.NOT_FOUND, "Disbursement not found");
    }
  }
  if (!["mobile_money", "airtime", "bonus_credits"].includes(row.prizeTypeKey)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Only automated prizes can be retried");
  }
  if (row.status !== "failed") {
    throw new AppError(StatusCodes.BAD_REQUEST, `Only failed prizes can be retried (current: ${row.status})`);
  }

  // Refresh the phone in case the winner updated their profile
  const user = await User.findById(row.winnerUser).select("phone").lean();
  const txRef = row.prizeTypeKey === "mobile_money" ? generateAirtelId("PRZ") : newTxRef();

  const updated = await Disbursement.findOneAndUpdate(
    { _id: id, status: "failed" },
    {
      $set: { status: "pending", txRef, phone: (user as any)?.phone || row.phone, failureReason: null },
      $unset: { providerRequestId: 1, providerReference: 1 },
    },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw new AppError(StatusCodes.CONFLICT, "Disbursement changed, please refresh");

  const doc = updated as unknown as TDisbursement;
  if (doc.prizeTypeKey === "mobile_money") await dispatchMobileMoney(doc);
  else if (doc.prizeTypeKey === "airtime") {
    const challenge = await Challenge.findById(doc.challenge).select("currency").lean();
    await dispatchAirtime(doc, challenge?.currency || "UGX");
  } else await dispatchBonusCredits(doc, String(doc.challenge));

  return Disbursement.findById(id).lean();
};

/**
 * Phase 1 (one transaction): create one "pending" row per winner. The unique
 * {challenge, winnerUser} index makes a second run fail instead of duplicating.
 * Phase 2 (no transaction): pay each row, then notify winners and non-winners.
 */
const createDisbursementsForChallenge = async (challengeId: string): Promise<void> => {
  const challenge = await Challenge.findById(challengeId).lean();
  if (!challenge) return;

  const participations = await ChallengeParticipationRepository.findByChallengeIdSorted(challengeId);
  if (!participations || participations.length === 0) {
    logger.info(`[Disbursement] No participations found for challenge ${challengeId}`);
    return;
  }

  const { Station } = await import("../station/station.model");
  const stationDoc = await Station.findById(challenge.station).lean();
  if (!stationDoc || stationDoc.isActive === false) {
    logger.error(`[Disbursement] Inactive or missing station ${challenge.station} for challenge ${challengeId}`);
    return;
  }

  const numberOfWinners = challenge.numberOfWinners || 1;
  const winnerCount = Math.min(numberOfWinners, participations.length);
  const winners = participations.slice(0, winnerCount);
  const nonWinners = participations.slice(winnerCount);

  const prizeTypeKey = challenge.prizeTypeKey || "other";
  const prizeLabel = challenge.prizeLabel || challenge.prizeTypeKey || "Reward";
  const prizeValueStr = challenge.currency
    ? `${challenge.currency} ${challenge.prizeValue}`
    : `${challenge.prizeValue}`;

  const provider =
    prizeTypeKey === "bonus_credits"
      ? "internal_credit"
      : prizeTypeKey === "airtime"
        ? "africas_talking"
        : prizeTypeKey === "mobile_money"
          ? "mobile_money"
          : "manual";

  // ── Phase 1: create rows atomically ──
  const session = await mongoose.startSession();
  let rows: TDisbursement[] = [];
  try {
    session.startTransaction();
    const existingCount = await Disbursement.countDocuments({ challenge: challenge._id }).session(session);
    if (existingCount > 0) {
      logger.info(`[Disbursement] Disbursements already created for challenge ${challengeId}`);
      await session.abortTransaction();
      return;
    }

    const users = await User.find({ _id: { $in: winners.map((w) => w.user) } })
      .select("fullName phone")
      .session(session)
      .lean();
    const userById = new Map(users.map((u: any) => [String(u._id), u]));

    const docs = winners.map((winner) => {
      const user: any = userById.get(String(winner.user));
      return {
        challenge: challenge._id,
        winnerUser: winner.user,
        winnerName: user?.fullName || "Participant",
        phone: user?.phone || "",
        station: challenge.station,
        prizeTypeKey,
        prizeLabel,
        prizeValue: prizeValueStr,
        // Mobile money ids must match the operator's format (sent as the transaction id)
        txRef: prizeTypeKey === "mobile_money" ? generateAirtelId("PRZ") : newTxRef(),
        provider,
        status: "pending",
      };
    });

    const inserted = await Disbursement.insertMany(docs, { session });
    rows = inserted.map((d) => d.toObject() as unknown as TDisbursement);
    await session.commitTransaction();
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    logger.error(`[Disbursement] Error creating disbursements for challenge ${challengeId}:`, error);
    return;
  } finally {
    await session.endSession();
  }

  // ── Phase 2: pay and notify (outside any transaction) ──
  const isPhysical = PHYSICAL_PRIZES.includes(prizeTypeKey);

  for (const row of rows) {
    if (prizeTypeKey === "bonus_credits") {
      await dispatchBonusCredits(row, challengeId);
    } else if (prizeTypeKey === "airtime") {
      await dispatchAirtime(row, challenge.currency || "UGX");
    } else if (prizeTypeKey === "mobile_money") {
      await dispatchMobileMoney(row);
    }
    // Physical prizes stay "pending" until the station hands them over

    let winnerMessage: string;
    if (isPhysical) {
      winnerMessage = `🎉 Congratulations! You have won a ${challenge.prizeLabel || "prize"} in ${challenge.title}. Please contact the station to collect your prize.`;
    } else if (prizeTypeKey === "mobile_money") {
      winnerMessage = `🎉 Congratulations! You have won ${prizeValueStr} in ${challenge.title}. It will be sent to your mobile money number.`;
    } else if (prizeTypeKey === "airtime") {
      winnerMessage = `🎉 Congratulations! You have won ${prizeValueStr} airtime in ${challenge.title}. It will be sent to your phone shortly.`;
    } else if (prizeTypeKey === "bonus_credits") {
      winnerMessage = `🎉 Congratulations! You have won ${prizeValueStr} credits in ${challenge.title}. They have been added to your account.`;
    } else {
      winnerMessage = `🎉 Congratulations! You have won ${prizeValueStr} in ${challenge.title}.`;
    }

    await notifySafely({
      userId: String(row.winnerUser),
      title: "🎉 Congratulations! You Won!",
      body: winnerMessage,
      type: "system",
      data: {
        challengeId: String(challengeId),
        kind: "challenge_result",
        type: "challenge_winner",
        route: `/challenge-result/${challengeId}`,
      },
    });
  }

  // Same message for every non-winner: one bulk send instead of one notification at a time
  if (nonWinners.length > 0) {
    try {
      await NotificationService.sendBulkNotifications(
        nonWinners.map((nonWinner) => String(nonWinner.user)),
        "Challenge Completed",
        `Thank you for participating in ${challenge.title}. Unfortunately, you were not among the winners this time. Keep participating in future challenges!`,
        "system",
        {
          challengeId: String(challengeId),
          kind: "challenge_result",
          type: "challenge_result",
          route: `/challenge-result/${challengeId}`,
        },
      );
    } catch (err) {
      logger.warn(`[Disbursement] Bulk non-winner notification failed for challenge ${challengeId}:`, err);
    }
  }
};

/**
 * Payout job (runs from the payment reconciler):
 * - airtime rows created but never claimed (e.g. server restarted mid-run)
 * - mobile money rows still pending (rail not activated yet, daily limit, restart)
 * - in-flight mobile money payouts resolved via operator enquiry
 */
const processPendingPayouts = async () => {
  const stale = await Disbursement.find({
    prizeTypeKey: "airtime",
    status: "pending",
    providerRequestId: { $in: [null, ""] },
    createdAt: { $lte: new Date(Date.now() - AIRTIME_RETRY_MIN_AGE_MS) },
  })
    .limit(20)
    .lean();

  for (const row of stale) {
    const challenge = await Challenge.findById(row.challenge).select("currency").lean();
    await dispatchAirtime(row as unknown as TDisbursement, challenge?.currency || "UGX");
  }

  const pendingMoney = await Disbursement.find({
    prizeTypeKey: "mobile_money",
    status: "pending",
    updatedAt: { $lte: new Date(Date.now() - MOBILE_MONEY_RETRY_MIN_AGE_MS) },
  })
    .sort({ createdAt: 1 })
    .limit(20)
    .lean();

  for (const row of pendingMoney) {
    await dispatchMobileMoney(row as unknown as TDisbursement);
  }

  await reconcileMobileMoneyPayouts();
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

const handleAfricasTalkingWebhook = async (payload: {
  status?: string;
  requestId?: string;
  transactionId?: string;
  category?: string;
  description?: string;
  value?: string;
}) => {
  const { requestId, status, description } = payload || {};
  logger.info(`[AT Airtime Webhook] Delivery report: requestId=${requestId}, status=${status}`);

  if (!requestId) return { received: true };

  const isSuccess = String(status || "").toLowerCase() === "success";
  // Only an in-flight row can be finalised; a late/duplicate report never flips a final status
  const disbursement = await Disbursement.findOneAndUpdate(
    { providerRequestId: requestId, status: "processing" },
    {
      $set: {
        status: isSuccess ? "successful" : "failed",
        processedAt: new Date(),
        failureReason: isSuccess ? null : description || "Airtime delivery failed",
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!disbursement) {
    logger.warn(`[AT Airtime Webhook] No in-flight disbursement for requestId=${requestId}`);
    return { received: true };
  }

  if (isSuccess) {
    await notifySafely({
      userId: String(disbursement.winnerUser),
      title: "Airtime delivered",
      body: `Your airtime prize of ${disbursement.prizeValue} has been delivered to your phone.`,
      type: "system",
      data: { kind: "challenge_result", challengeId: String(disbursement.challenge) },
    });
  }
  return { received: true };
};

export const DisbursementService = {
  createDisbursementsForChallenge,
  getDisbursements,
  handleAfricasTalkingWebhook,
  processPendingPayouts,
  retryDisbursement,
};
