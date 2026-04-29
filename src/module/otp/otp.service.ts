import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { StatusCodes } from "http-status-codes/build/cjs/status-codes";

import AppError from "errors/AppError";
import config from "config";
import { logger } from "logger/logger";
import { isAfricasTalkingCountry, sendAtOtp } from "util/africasTalking";
import { sendTwilioOtp } from "util/twilioOtp";

import { OTPType, createOTPData } from "./otp.interface";
import { OTPRepository } from "./otp.repository";
import { OTPCacheManager, TCachedOtpRecord } from "./otp.cacheManage";

// ─── Constants ────────────────────────────────────────────────────────────────

const OTP_BCRYPT_ROUNDS = Number(config.bcrypt_salt_rounds) || 10;
const OTP_EXPIRY_MINUTES = 30;
const OTP_MAX_ATTEMPTS = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildCachedOtpRecord = (payload: {
  _id: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  otpHash: string;
  type: OTPType;
  provider: "phone";
  target: string;
  expiresAt: Date | string;
  attempts?: number;
  maxAttempts?: number;
  isUsed?: boolean;
}): TCachedOtpRecord => ({
  _id: String(payload._id),
  userId: String(payload.userId),
  otpHash: payload.otpHash,
  type: payload.type,
  provider: payload.provider,
  target: payload.target,
  expiresAt:
    payload.expiresAt instanceof Date
      ? payload.expiresAt.toISOString()
      : payload.expiresAt,
  attempts: payload.attempts ?? 0,
  maxAttempts: payload.maxAttempts ?? OTP_MAX_ATTEMPTS,
  isUsed: payload.isUsed ?? false,
});

const getActiveOtpRecord = async (userId: Types.ObjectId, type: OTPType) => {
  const cachedOtp = await OTPCacheManager.getActiveOtp(userId, type);
  if (cachedOtp) return cachedOtp;

  const now = new Date();
  const otpDoc = await OTPRepository.findOne({
    userId,
    type,
    isUsed: false,
    expiresAt: { $gt: now },
    $expr: { $lt: ["$attempts", "$maxAttempts"] },
  }).select("+otp");

  if (!otpDoc) return null;

  const otpRecord = buildCachedOtpRecord({
    _id: otpDoc._id,
    userId: otpDoc.userId,
    otpHash: otpDoc.otp,
    type: otpDoc.type,
    provider: otpDoc.provider,
    target: otpDoc.target,
    expiresAt: otpDoc.expiresAt,
    attempts: otpDoc.attempts,
    maxAttempts: otpDoc.maxAttempts,
    isUsed: otpDoc.isUsed,
  });

  await OTPCacheManager.setActiveOtp(otpRecord);
  return otpRecord;
};

// ─── SMS Routing ─────────────────────────────────────────────────────────────

const sendOtpViaSms = async (
  phone: string,
  otp: string,
  countryName: string,
): Promise<void> => {
  if (isAfricasTalkingCountry(countryName)) {
    logger.info(`[OTP] Routing to Africa's Talking for country: ${countryName}`);
    await sendAtOtp(phone, otp);
  } else {
    logger.info(`[OTP] Routing to Twilio for country: ${countryName}`);
    await sendTwilioOtp(phone, otp);
  }
};

// ─── Service ─────────────────────────────────────────────────────────────────

const createOTP = async (createOtpData: createOTPData) => {
  const { userId, type, provider, target, countryName } = createOtpData;

  // Delete any existing unused OTPs of the same type for this user
  await OTPRepository.deleteMany({ userId, type, isUsed: false });
  //TODO : Update before production
  // const otp = generateOTP();
   const otp = "1234"
  const otpHash = await bcrypt.hash(otp, OTP_BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const otpDoc = await OTPRepository.create({
    userId,
    otp: otpHash,
    type,
    provider,
    target,
    expiresAt,
    maxAttempts: OTP_MAX_ATTEMPTS,
  });

  await OTPCacheManager.setActiveOtp(
    buildCachedOtpRecord({
      _id: otpDoc._id,
      userId,
      otpHash,
      type,
      provider,
      target,
      expiresAt,
      attempts: otpDoc.attempts,
      maxAttempts: otpDoc.maxAttempts,
      isUsed: otpDoc.isUsed,
    }),
  );

  logger.info(`[OTP] Created for user ${userId}, type=${type}, provider=${provider}`);

  // Send OTP via appropriate SMS provider
  await sendOtpViaSms(target, otp, countryName);

  return { otpDoc };
};

const verifyOTP = async (
  userId: Types.ObjectId,
  type: OTPType,
  inputOTP: string,
) => {
  const now = new Date();
  const otpRecord = await getActiveOtpRecord(userId, type);

  if (!otpRecord) {
    const exhaustedOtpDoc = await OTPRepository.findOne({
      userId,
      type,
      expiresAt: { $gt: now },
      $expr: { $gte: ["$attempts", "$maxAttempts"] },
    });

    if (exhaustedOtpDoc) {
      throw new AppError(StatusCodes.TOO_MANY_REQUESTS, "Too many failed attempts");
    }

    throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
  }

  const isMatched = await bcrypt.compare(inputOTP, otpRecord.otpHash);

  if (isMatched) {
    const verifiedOtpDoc = await OTPRepository.findOneAndUpdate(
      {
        _id: otpRecord._id,
        isUsed: false,
        expiresAt: { $gt: now },
        $expr: { $lt: ["$attempts", "$maxAttempts"] },
      },
      { $set: { isUsed: true } },
      { returnDocument: "after" },
    );

    if (verifiedOtpDoc) {
      await OTPCacheManager.deleteActiveOtp(userId, type);
      return verifiedOtpDoc;
    }

    await OTPCacheManager.deleteActiveOtp(userId, type);
    throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
  }

  // Increment failed attempt atomically
  const failedAttemptDoc = await OTPRepository.findOneAndUpdate(
    {
      _id: otpRecord._id,
      isUsed: false,
      expiresAt: { $gt: now },
      $expr: { $lt: ["$attempts", "$maxAttempts"] },
    },
    [
      {
        $set: {
          attempts: { $add: ["$attempts", 1] },
          isUsed: {
            $cond: [
              { $gte: [{ $add: ["$attempts", 1] }, "$maxAttempts"] },
              true,
              "$isUsed",
            ],
          },
        },
      },
    ],
    { returnDocument: "after" },
  );

  if (failedAttemptDoc) {
    if (failedAttemptDoc.attempts >= failedAttemptDoc.maxAttempts) {
      await OTPCacheManager.deleteActiveOtp(userId, type);
      throw new AppError(StatusCodes.TOO_MANY_REQUESTS, "Too many failed attempts");
    }

    await OTPCacheManager.setActiveOtp(
      buildCachedOtpRecord({
        _id: failedAttemptDoc._id,
        userId,
        otpHash: otpRecord.otpHash,
        type,
        provider: failedAttemptDoc.provider,
        target: failedAttemptDoc.target,
        expiresAt: failedAttemptDoc.expiresAt,
        attempts: failedAttemptDoc.attempts,
        maxAttempts: failedAttemptDoc.maxAttempts,
        isUsed: failedAttemptDoc.isUsed,
      }),
    );

    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid OTP");
  }

  await OTPCacheManager.deleteActiveOtp(userId, type);
  throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired or not found");
};

export const OTPService = {
  createOTP,
  verifyOTP,
};
