import cacheService from "../../redis/cacheService";
import { buildCacheKey, buildCachePattern } from "../../redis/cache.utils";
import config from "../../config";

const TTL = {
  profile: Number(config.cache.ttl.userProfileSeconds) || 300, // 5min
};

const KEYS = {
  profile: (userId: string) => buildCacheKey("user", "profile", userId),
  profileByAuth: (authId: string) => buildCacheKey("user", "auth", authId),
  pattern: () => buildCachePattern("user", "*"),
};

const getProfile = (userId: string) => {
  return cacheService.getCache<any>(KEYS.profile(userId));
};

const setProfile = (userId: string, data: any) => {
  return cacheService.setCache(KEYS.profile(userId), data, TTL.profile);
};

const invalidateProfile = (userId: string) => {
  cacheService.deleteCache(KEYS.profile(userId));
  cacheService.deleteCache(KEYS.profileByAuth(userId));
};

const invalidateAllUserProfiles = () => {
  cacheService.invalidateByPattern(KEYS.pattern());
};

export const UserCache = {
  getProfile,
  setProfile,
  invalidateProfile,
  invalidateAllUserProfiles,
  KEYS,
  TTL,
};
