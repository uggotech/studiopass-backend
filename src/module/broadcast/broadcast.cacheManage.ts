import config from "config";

import cacheService from "../../redis/cacheService";
import { buildCacheKey, buildCachePattern } from "../../redis/cache.utils";

const BROADCAST_DETAIL_TTL = Number(config.cache.ttl.userProfileSeconds) || 300;
const BROADCAST_LIST_TTL = 120;

export type TCachedBroadcast = Record<string, unknown>;
export type TCachedBroadcastList = {
  items: TCachedBroadcast[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPage: number;
  };
};

const getBroadcastDetailKey = (broadcastId: string) => {
  return buildCacheKey("broadcast", "detail", broadcastId);
};

const getBroadcastListKey = (cacheKey: string) => {
  return buildCacheKey("broadcast", "list", cacheKey);
};

export const BroadcastCacheManager = {
  getById(broadcastId: string) {
    return cacheService.getCache<TCachedBroadcast>(getBroadcastDetailKey(broadcastId));
  },

  setById(broadcastId: string, payload: TCachedBroadcast) {
    return cacheService.setCache(
      getBroadcastDetailKey(broadcastId),
      payload,
      BROADCAST_DETAIL_TTL,
    );
  },

  invalidateById(broadcastId: string) {
    return cacheService.deleteCache(getBroadcastDetailKey(broadcastId));
  },

  getList(cacheKey: string) {
    return cacheService.getCache<TCachedBroadcastList>(getBroadcastListKey(cacheKey));
  },

  setList(cacheKey: string, payload: TCachedBroadcastList) {
    return cacheService.setCache(
      getBroadcastListKey(cacheKey),
      payload,
      BROADCAST_LIST_TTL,
    );
  },

  invalidateLists() {
    return cacheService.invalidateByPattern(buildCachePattern("broadcast", "list", "*"));
  },

  invalidateAll() {
    return cacheService.invalidateByPattern(buildCachePattern("broadcast", "*"));
  },
};