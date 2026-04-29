import { Types } from "mongoose";

import cacheService from "../../redis/cacheService";
import {
  buildCacheKey,
  buildCachePattern,
  getSecondsUntil,
} from "../../redis/cache.utils";
import { OTPProvider, OTPType } from "./otp.interface";

type TCachedOtpRecord = {
  _id: string;
  userId: string;
  otpHash: string;
  type: OTPType;
  provider: OTPProvider;
  target: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
};

const getOtpKey = (userId: Types.ObjectId | string, type: OTPType) => {
  return buildCacheKey("otp", String(userId), type);
};

export const OTPCacheManager = {
  async getActiveOtp(userId: Types.ObjectId | string, type: OTPType) {
    const key = getOtpKey(userId, type);
    const cachedOtp = await cacheService.getCache<TCachedOtpRecord>(key);

    if (!cachedOtp) {
      return null;
    }

    const isExpired = new Date(cachedOtp.expiresAt).getTime() <= Date.now();
    const isExhausted = cachedOtp.attempts >= cachedOtp.maxAttempts;

    if (cachedOtp.isUsed || isExpired || isExhausted) {
      await cacheService.deleteCache(key);
      return null;
    }

    return cachedOtp;
  },

  setActiveOtp(payload: TCachedOtpRecord) {
    return cacheService.setCache(
      getOtpKey(payload.userId, payload.type),
      payload,
      getSecondsUntil(payload.expiresAt),
    );
  },

  deleteActiveOtp(userId: Types.ObjectId | string, type: OTPType) {
    return cacheService.deleteCache(getOtpKey(userId, type));
  },

  invalidateUserOtps(userId: Types.ObjectId | string) {
    return cacheService.invalidateByPattern(
      buildCachePattern("otp", String(userId), "*"),
    );
  },
};

export type { TCachedOtpRecord };