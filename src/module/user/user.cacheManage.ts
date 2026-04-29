import config from "config";

import cacheService from "../../redis/cacheService";
import { buildCacheKey } from "../../redis/cache.utils";

type TCachedUserProfile = Record<string, unknown>;

const USER_PROFILE_TTL = Number(config.cache.ttl.userProfileSeconds) || 300;

const getUserProfileKey = (userId: string) => {
  return buildCacheKey("user", "profile", userId);
};

export const UserCacheManager = {
  getProfile(userId: string) {
    return cacheService.getCache<TCachedUserProfile>(getUserProfileKey(userId));
  },

  setProfile(userId: string, payload: TCachedUserProfile) {
    return cacheService.setCache(
      getUserProfileKey(userId),
      payload,
      USER_PROFILE_TTL,
    );
  },

  invalidateProfile(userId: string) {
    return cacheService.deleteCache(getUserProfileKey(userId));
  },
};

export type { TCachedUserProfile };
