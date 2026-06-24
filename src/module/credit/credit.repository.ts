import { CreditBalance } from "../creditBalance/creditBalance.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";

const getBalance = async (userId: string) => {
  return CreditBalance.findOne({ user: userId }).lean();
};

const incrementBalance = async (userId: string, amount: number) => {
  return CreditBalance.findOneAndUpdate(
    { user: userId },
    { $inc: { balance: amount } },
    { new: true, upsert: true },
  ).lean();
};

const decrementBalance = async (userId: string, amount: number) => {
  return CreditBalance.findOneAndUpdate(
    { user: userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true },
  ).lean();
};

const createTransaction = async (data: Record<string, unknown>) => {
  const doc = new CreditTransaction(data);
  await doc.save();
  return doc.toObject();
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

export const CreditRepository = {
  getBalance,
  incrementBalance,
  decrementBalance,
  createTransaction,
  getTransactionsByUser,
  countTransactionsByUser,
};
