import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CreditRepository } from "./credit.repository";
import { User } from "../user/user.model";
import { Country } from "../country/country.model";

const getBalance = async (userId: string) => {
  const doc = await CreditRepository.getBalance(userId);
  return { balance: doc?.balance ?? 0 };
};

/**
 * Deduct credits from a user's balance.
 *
 * Supports optional MongoDB session for transaction wrapping.
 * Auto-detects isFree based on the user's most recent credit source:
 * - If last transaction was admin_grant (isFree: true), deduction is free
 * - Otherwise, deduction is paid
 *
 * @param userId - The user to deduct from
 * @param amount - Number of credits to deduct
 * @param stationId - Station where credits are being spent
 * @param resourceId - The message/call ID consuming credits
 * @param resourceType - "message" or "call"
 * @param session - Optional MongoDB session for transaction support
 * @returns Updated balance and whether the deduction was free
 */
const deductCredits = async (
  userId: string,
  amount: number,
  stationId: string,
  resourceId: string,
  resourceType: "message" | "call" | "challenge" | "poll",
  session?: mongoose.ClientSession,
) => {
  // Atomic decrement with $gte condition — if insufficient balance, returns null
  const result = await CreditRepository.decrementBalance(userId, amount, session);

  if (!result || !result.updated) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Insufficient credits. Top up to send messages.",
    );
  }

  const { updated, isFreeDeduction } = result;

  // Check if user is operating on free credits (admin grant history or freeBalance)
  const isFreeFromHistory = await CreditRepository.isUserOnFreeCredits(userId);
  const isFree = isFreeDeduction || isFreeFromHistory;

  // User country lookup
  const user = await User.findById(userId).select("countryId").lean();
  const countryDoc = user?.countryId
    ? await Country.findById(user.countryId).select("code currency callCreditPrice messageCreditPrice").lean()
    : null;

  const creditPrice = resourceType === "call"
    ? (countryDoc?.callCreditPrice ?? 0)
    : (countryDoc?.messageCreditPrice ?? 0);

  // Map resourceType to transaction type
  const txType = resourceType === "message"
    ? "message_deduction"
    : resourceType === "call"
      ? "call_deduction"
      : resourceType === "challenge"
        ? "challenge_deduction"
        : "poll_deduction";

  await CreditRepository.createTransaction({
    user: userId,
    type: txType,
    amount: -amount,
    isFree,
    station: stationId,
    resourceType,
    resourceId,
    country: user?.countryId || undefined,
    currency: countryDoc?.currency || undefined,
    localAmount: isFree ? 0 : amount * creditPrice,
    status: "completed",
  }, session);

  return { balance: updated.balance, isFree };
};

/**
 * Refund credits to a user's balance.
 *
 * Used when a call is not answered (cancelled, missed, timed out).
 * The credit was reserved at request time; this restores it.
 *
 * @param userId - The user to refund
 * @param amount - Number of credits to refund
 * @param stationId - Station where the call was made
 * @param resourceId - The call ID being refunded
 * @param resourceType - "call"
 * @param session - Optional MongoDB session for transaction support
 * @returns Updated balance
 */
const refundCredits = async (
  userId: string,
  amount: number,
  stationId: string,
  resourceId: string,
  resourceType: "call" | "challenge" | "poll",
  session?: mongoose.ClientSession,
) => {
  // Look up original deduction's isFree to preserve it in the refund record
  const originalTxType = resourceType === "challenge"
    ? "challenge_deduction"
    : resourceType === "poll"
    ? "poll_deduction"
    : "call_deduction";

  const originalTx = await CreditRepository.getTransactionByResource(resourceId, originalTxType);
  const isFree = originalTx?.isFree ?? false;

  const updated = await CreditRepository.incrementBalance(userId, amount, isFree, session);

  const refundType = resourceType === "challenge"
    ? "challenge_refund"
    : resourceType === "poll"
    ? "poll_refund"
    : "call_refund";

  await CreditRepository.createTransaction({
    user: userId,
    type: refundType,
    amount,
    isFree,
    station: stationId,
    resourceType,
    resourceId,
    status: "completed",
  }, session);

  return { balance: updated?.balance ?? 0 };
};

const addCredits = async (
  userId: string,
  amount: number,
  adminId: string,
  isFree: boolean = true,
  session?: mongoose.ClientSession,
  paymentReference?: string,
  idempotencyKey?: string,
  reason?: string,
  adminUser?: { role?: string; fullName?: string },
) => {
  // Validate user exists before creating balance
  const user = await User.findById(userId).select("countryId").lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  // Idempotency check: if paymentReference or idempotencyKey provided, return existing balance if already processed
  const refKey = paymentReference || idempotencyKey;
  if (refKey) {
    const { CreditTransaction } = await import("../creditTransaction/creditTransaction.model");
    const existing = await CreditTransaction.findOne({
      $or: [{ paymentReference: refKey }, { txRef: refKey }],
      status: "completed",
    }).lean();
    if (existing) {
      const current = await CreditRepository.getBalance(userId);
      return { balance: current?.balance ?? 0, duplicate: true };
    }
  }

  const prevDoc = await CreditRepository.getBalance(userId);
  const previousBalance = prevDoc?.balance ?? 0;

  const updated = await CreditRepository.incrementBalance(userId, amount, isFree, session);
  const newBalance = updated?.balance ?? (previousBalance + amount);

  // Look up country currency for transaction record
  const countryDoc = user.countryId
    ? await Country.findById(user.countryId).select("code currency").lean()
    : null;

  await CreditRepository.createTransaction({
    user: userId,
    type: "admin_grant",
    amount,
    isFree,
    previousBalance,
    newBalance,
    reason: reason || undefined,
    adminRole: adminUser?.role || undefined,
    adminName: adminUser?.fullName || undefined,
    country: user.countryId || undefined,
    currency: countryDoc?.currency || undefined,
    grantedBy: adminId,
    paymentReference: paymentReference || undefined,
    status: "completed",
  }, session);

  return { balance: newBalance };
};

const deductCreditsByAdmin = async (
  userId: string,
  amount: number,
  adminId: string,
  reason: string,
  adminUser?: { role?: string; fullName?: string },
) => {
  const user = await User.findById(userId).select("countryId").lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const currentDoc = await CreditRepository.getBalance(userId);
  const currentBalance = currentDoc?.balance ?? 0;

  if (currentBalance < amount) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Cannot deduct ${amount} credits. User only has ${currentBalance} available credits.`,
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const previousBalance = currentBalance;
    const { updated } = await CreditRepository.decrementBalance(userId, amount, session);

    if (!updated) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Insufficient user credit balance");
    }

    const newBalance = updated.balance;

    const countryDoc = user.countryId
      ? await Country.findById(user.countryId).select("code currency").lean()
      : null;

    await CreditRepository.createTransaction({
      user: userId,
      type: "admin_deduction",
      amount: -amount,
      isFree: true,
      previousBalance,
      newBalance,
      reason,
      adminRole: adminUser?.role || undefined,
      adminName: adminUser?.fullName || undefined,
      country: user.countryId || undefined,
      currency: countryDoc?.currency || undefined,
      grantedBy: adminId,
      status: "completed",
    }, session);

    await session.commitTransaction();
    return { balance: newBalance, previousBalance, deducted: amount };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const rewardChallengeWinner = async (
  userId: string,
  amount: number,
  stationId: string,
  challengeId: string,
  session?: mongoose.ClientSession,
) => {
  const user = await User.findById(userId).lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await CreditRepository.incrementBalance(userId, amount, true, session);

  const countryDoc = user.countryId
    ? await Country.findById(user.countryId).select("code currency").lean()
    : null;

  await CreditRepository.createTransaction({
    user: userId as any,
    type: "challenge_reward",
    amount,
    isFree: true,
    country: user.countryId || undefined,
    currency: countryDoc?.currency || undefined,
    station: stationId as any,
    resourceType: "challenge",
    resourceId: challengeId as any,
    status: "completed",
  }, session);

  return { balance: updated?.balance ?? 0 };
};

export const CreditService = {
  getBalance,
  deductCredits,
  refundCredits,
  addCredits,
  deductCreditsByAdmin,
  rewardChallengeWinner,
};

