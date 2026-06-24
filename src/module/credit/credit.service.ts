import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CreditRepository } from "./credit.repository";
import { User } from "../user/user.model";
import { Country } from "../country/country.model";

const getBalance = async (userId: string) => {
  const doc = await CreditRepository.getBalance(userId);
  return { balance: doc?.balance ?? 0 };
};

const deductCredits = async (
  userId: string,
  amount: number,
  stationId: string,
  resourceId: string,
  resourceType: "message" | "call",
) => {
  const { balance } = await getBalance(userId);

  if (balance < amount) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Insufficient credits. Top up to send messages.",
    );
  }

  const updated = await CreditRepository.decrementBalance(userId, amount);

  // Look up user's country and currency for transaction record
  const user = await User.findById(userId).select("countryId").lean();
  const countryDoc = user?.countryId
    ? await Country.findById(user.countryId).select("code currency").lean()
    : null;

  await CreditRepository.createTransaction({
    user: userId,
    type: resourceType === "message" ? "message_deduction" : "call_deduction",
    amount: -amount,
    isFree: false,
    station: stationId,
    resourceType,
    resourceId,
    country: user?.countryId || undefined,
    currency: countryDoc?.currency || undefined,
    status: "completed",
  });

  return { balance: updated?.balance ?? 0 };
};

const addCredits = async (
  userId: string,
  amount: number,
  adminId: string,
  isFree: boolean = true,
) => {
  // Validate user exists before creating balance
  const user = await User.findById(userId).select("countryId").lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await CreditRepository.incrementBalance(userId, amount);

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
  });

  return { balance: updated?.balance ?? 0 };
};

export const CreditService = {
  getBalance,
  deductCredits,
  addCredits,
};
