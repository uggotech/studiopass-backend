import cacheService from "../../redis/cacheService";
import { buildCacheKey, buildCachePattern } from "../../redis/cache.utils";

import type { TFollowStatus } from "./follow.interface";

const FOLLOW_STATUS_TTL = 120;
const FOLLOWER_COUNT_TTL = 120;

const getFollowStatusKey = (userId: string, broadcastId: string) => {
  return buildCacheKey("follow", "status", userId, broadcastId);
};

const getFollowerCountKey = (broadcastId: string) => {
  return buildCacheKey("follow", "count", broadcastId);
};

export const FollowCacheManager = {
  getFollowStatus(userId: string, broadcastId: string) {
    return cacheService.getCache<TFollowStatus>(getFollowStatusKey(userId, broadcastId));
  },

  setFollowStatus(userId: string, broadcastId: string, payload: TFollowStatus) {
    return cacheService.setCache(
      getFollowStatusKey(userId, broadcastId),
      payload,
      FOLLOW_STATUS_TTL,
    );
  },

  invalidateFollowStatus(userId: string, broadcastId: string) {
    return cacheService.deleteCache(getFollowStatusKey(userId, broadcastId));
  },

  getFollowerCount(broadcastId: string) {
    return cacheService.getCache<number>(getFollowerCountKey(broadcastId));
  },

  setFollowerCount(broadcastId: string, count: number) {
    return cacheService.setCache(getFollowerCountKey(broadcastId), count, FOLLOWER_COUNT_TTL);
  },

  invalidateFollowerCount(broadcastId: string) {
    return cacheService.deleteCache(getFollowerCountKey(broadcastId));
  },

  invalidateBroadcastFollowCaches(broadcastId: string) {
    return cacheService.invalidateByPattern(buildCachePattern("follow", "*", "*", broadcastId));
  },
};