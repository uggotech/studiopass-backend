import mongoose from "mongoose";
import { CreditBalance } from "../creditBalance/creditBalance.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";

const getBalance = async (userId: string) => {
  return CreditBalance.findOne({ user: userId }).lean();
};

const incrementBalance = async (userId: string, amount: number, session?: mongoose.ClientSession) => {
  const opts = session ? { session, new: true, upsert: true } : { new: true, upsert: true };
  return CreditBalance.findOneAndUpdate(
    { user: userId },
    { $inc: { balance: amount } },
    opts,
  ).lean();
};

const decrementBalance = async (userId: string, amount: number, session?: mongoose.ClientSession) => {
  const opts = session ? { session, new: true } : { new: true };
  return CreditBalance.findOneAndUpdate(
    { user: userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    opts,
  ).lean();
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
 * Find the most recent credit transaction for a user to determine if their
 * balance came from admin grants (free) vs purchases.
 */
const getLastCreditSource = async (userId: string): Promise<{ isFree: boolean } | null> => {
  const lastTx = await CreditTransaction.findOne({ user: userId })
    .select("isFree")
    .sort({ createdAt: -1 })
    .lean();
  if (!lastTx) return null;
  return { isFree: lastTx.isFree };
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

export const CreditRepository = {
  getBalance,
  incrementBalance,
  decrementBalance,
  createTransaction,
  getLastCreditSource,
  getTransactionsByUser,
  countTransactionsByUser,
  getAllTransactions,
  countAllTransactions,
};
