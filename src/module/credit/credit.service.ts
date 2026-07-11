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
  resourceType: "message" | "call",
  session?: mongoose.ClientSession,
) => {
  // Atomic decrement with $gte condition — if insufficient balance, returns null
  const updated = await CreditRepository.decrementBalance(userId, amount, session);

  if (!updated) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Insufficient credits. Top up to send messages.",
    );
  }

  // Parallel lookups: last credit source + user country (independent)
  const [lastSource, user] = await Promise.all([
    CreditRepository.getLastCreditSource(userId),
    User.findById(userId).select("countryId").lean(),
  ]);
  const isFree = lastSource?.isFree ?? false;

  // Country lookup depends on user's countryId
  const countryDoc = user?.countryId
    ? await Country.findById(user.countryId).select("code currency").lean()
    : null;

  await CreditRepository.createTransaction({
    user: userId,
    type: resourceType === "message" ? "message_deduction" : "call_deduction",
    amount: -amount,
    isFree,
    station: stationId,
    resourceType,
    resourceId,
    country: user?.countryId || undefined,
    currency: countryDoc?.currency || undefined,
    status: "completed",
  }, session);

  return { balance: updated.balance, isFree };
};

const addCredits = async (
  userId: string,
  amount: number,
  adminId: string,
  isFree: boolean = true,
  session?: mongoose.ClientSession,
) => {
  // Validate user exists before creating balance
  const user = await User.findById(userId).select("countryId").lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await CreditRepository.incrementBalance(userId, amount, session);

  // Look up country currency for transaction record
  const countryDoc = user.countryId
    ? await Country.findById(user.countryId).select("code currency").lean()
    : null;

  await CreditRepository.createTransaction({
    user: userId,
    type: "admin_grant",
    amount,
    isFree,
    country: user.countryId || undefined,
    currency: countryDoc?.currency || undefined,
    grantedBy: adminId,
    status: "completed",
  }, session);

  return { balance: updated?.balance ?? 0 };
};

export const CreditService = {
  getBalance,
  deductCredits,
  addCredits,
};
