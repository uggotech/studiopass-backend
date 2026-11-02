import { Schema, model, Types } from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import config from "../../config";

/**
 * Prize payout limits, editable by the Super Admin. A single document (_id "payout").
 * Until the first save the defaults from config.payout (env) apply.
 */
export interface PayoutLimits {
  /** Max prize for ONE winner (UGX). Applies to mobile money and airtime prizes. */
  maxPerWinnerUgx: number;
  /** Max total of automated prizes (mobile money + airtime) per day, Africa/Kampala (UGX). 0 = no limit. */
  dailyLimitUgx: number;
}

interface TPayoutSettings extends PayoutLimits {
  _id: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSettingsSchema = new Schema<TPayoutSettings>(
  {
    _id: { type: String, default: "payout" },
    maxPerWinnerUgx: { type: Number, required: true },
    dailyLimitUgx: { type: Number, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const PayoutSettings = model<TPayoutSettings>("PayoutSettings", payoutSettingsSchema);

const CACHE_TTL_MS = 10_000;
let cached: { value: PayoutLimits; at: number } | null = null;

const envDefaults = (): PayoutLimits => ({
  maxPerWinnerUgx: config.payout.max_per_winner_ugx,
  dailyLimitUgx: config.payout.daily_limit_ugx,
});

export const invalidatePayoutLimitsCache = () => {
  cached = null;
};

/** Current limits (database value, else env defaults). Cached for a few seconds. */
export async function getPayoutLimits(): Promise<PayoutLimits> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const doc = await PayoutSettings.findById("payout").lean();
  const value = doc
    ? { maxPerWinnerUgx: doc.maxPerWinnerUgx, dailyLimitUgx: doc.dailyLimitUgx }
    : envDefaults();
  cached = { value, at: Date.now() };
  return value;
}

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

export async function updatePayoutLimits(
  patch: Partial<PayoutLimits>,
  updatedBy?: string,
): Promise<PayoutLimits> {
  const current = await getPayoutLimits();
  const next: PayoutLimits = {
    maxPerWinnerUgx: patch.maxPerWinnerUgx ?? current.maxPerWinnerUgx,
    dailyLimitUgx: patch.dailyLimitUgx ?? current.dailyLimitUgx,
  };

  if (!isWhole(next.maxPerWinnerUgx) || next.maxPerWinnerUgx < 1 || next.maxPerWinnerUgx > 10_000_000) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Maximum per winner must be a whole number between 1 and 10,000,000 UGX.");
  }
  if (!isWhole(next.dailyLimitUgx) || next.dailyLimitUgx < 0 || next.dailyLimitUgx > 100_000_000) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Daily limit must be a whole number (0 means no limit).");
  }
  if (next.dailyLimitUgx > 0 && next.dailyLimitUgx < next.maxPerWinnerUgx) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "The daily limit cannot be lower than the maximum per winner, or a single prize could never be paid.",
    );
  }

  await PayoutSettings.findOneAndUpdate(
    { _id: "payout" },
    { $set: { ...next, ...(updatedBy ? { updatedBy } : {}) } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  invalidatePayoutLimitsCache();
  return next;
}
