import mongoose from "mongoose";
import { CreditBalance } from "../creditBalance/creditBalance.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";

const getBalance = async (userId: string) => {
  return CreditBalance.findOne({ user: userId }).lean();
};

const incrementBalance = async (userId: string, amount: number, isFree: boolean = true, session?: mongoose.ClientSession) => {
  const opts = session ? { session, new: true, upsert: true } : { new: true, upsert: true };
  const incFields: Record<string, number> = { balance: amount };
  if (isFree) {
    incFields.freeBalance = amount;
  } else {
    incFields.paidBalance = amount;
  }
  return CreditBalance.findOneAndUpdate(
    { user: userId },
    { $inc: incFields },
    opts,
  ).lean();
};

const decrementBalance = async (userId: string, amount: number, session?: mongoose.ClientSession) => {
  const opts = session ? { session, new: true } : { new: true };

  // Look up current balance to determine free vs paid credit source
  const current = await CreditBalance.findOne({ user: userId }).lean();
  const free = Math.max(0, current?.freeBalance ?? 0);
  const paid = Math.max(0, current?.paidBalance ?? 0);

  const incFields: Record<string, number> = { balance: -amount };
  let isFreeDeduction = false;

  if (free >= amount) {
    incFields.freeBalance = -amount;
    isFreeDeduction = true;
  } else if (free > 0) {
    incFields.freeBalance = -free;
    const remaining = amount - free;
    if (paid > 0) {
      incFields.paidBalance = -Math.min(paid, remaining);
    }
    isFreeDeduction = true;
  } else {
    if (paid > 0) {
      incFields.paidBalance = -Math.min(paid, amount);
    }
    isFreeDeduction = false;
  }

  const updated = await CreditBalance.findOneAndUpdate(
    { user: userId, balance: { $gte: amount } },
    { $inc: incFields },
    opts,
  ).lean();

  return { updated, isFreeDeduction };
};

const createTransaction = async (data: Record<string, unknown>, session?: mongoose.ClientSession) => {
  const doc = new CreditTransaction(data);
  if (session) {
    await doc.save({ session });
  } else {
    await doc.save();
  }
  return doc.toObject();
};

/**
 * Check if the user's credits originate from an admin grant (free) vs paid purchase.
 */
const isUserOnFreeCredits = async (userId: string): Promise<boolean> => {
  const balanceDoc = await CreditBalance.findOne({ user: userId }).lean();
  if ((balanceDoc?.freeBalance ?? 0) > 0) return true;

  const hasAdminGrant = await CreditTransaction.exists({ user: userId, type: "admin_grant", isFree: true });
  const hasPaidPurchase = await CreditTransaction.exists({ user: userId, type: "purchase", isFree: false });

  if (hasAdminGrant && !hasPaidPurchase) return true;

  const lastGrantOrPurchase = await CreditTransaction.findOne({
    user: userId,
    type: { $in: ["admin_grant", "purchase"] },
  })
    .select("isFree")
    .sort({ createdAt: -1 })
    .lean();

  return lastGrantOrPurchase?.isFree ?? false;
};

const getTransactionsByUser = async (userId: string, skip: number, limit: number) => {
  return CreditTransaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countTransactionsByUser = async (userId: string) => {
  return CreditTransaction.countDocuments({ user: userId });
};

const getAllTransactions = async (filter: Record<string, unknown>, skip: number, limit: number) => {
  return CreditTransaction.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("country", "name code currency")
    .populate("user", "fullName phone")
    .populate("station", "name")
    .lean();
};

const countAllTransactions = async (filter: Record<string, unknown>) => {
  return CreditTransaction.countDocuments(filter);
};

const getTransactionByResource = async (resourceId: string, type: string) => {
  return CreditTransaction.findOne({ resourceId, type } as any)
    .select("isFree")
    .lean();
};

export const CreditRepository = {
  getBalance,
  incrementBalance,
  decrementBalance,
  createTransaction,
  isUserOnFreeCredits,
  getTransactionsByUser,
  countTransactionsByUser,
  getAllTransactions,
  countAllTransactions,
  getTransactionByResource,
};
