import cacheService from "../../redis/cacheService";
import { buildCacheKey, buildCachePattern } from "../../redis/cache.utils";

const UNREAD_COUNT_TTL = 60;
const RECENT_LIST_TTL = 60;

export type TCachedNotificationList = {
  items: Record<string, unknown>[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPage: number;
  };
};

const getUnreadCountKey = (userId: string) => {
  return buildCacheKey("notification", "unread", userId);
};

const getNotificationListKey = (cacheKey: string) => {
  return buildCacheKey("notification", "list", cacheKey);
};

export const NotificationCacheManager = {
  getUnreadCount(userId: string) {
    return cacheService.getCache<number>(getUnreadCountKey(userId));
  },

  setUnreadCount(userId: string, count: number) {
    return cacheService.setCache(getUnreadCountKey(userId), count, UNREAD_COUNT_TTL);
  },

  invalidateUnreadCount(userId: string) {
    return cacheService.deleteCache(getUnreadCountKey(userId));
  },

  getList(cacheKey: string) {
    return cacheService.getCache<TCachedNotificationList>(getNotificationListKey(cacheKey));
  },

  setList(cacheKey: string, payload: TCachedNotificationList) {
    return cacheService.setCache(getNotificationListKey(cacheKey), payload, RECENT_LIST_TTL);
  },

  invalidateUserLists(userId: string) {
    return cacheService.invalidateByPattern(buildCachePattern("notification", "list", userId, "*"));
  },
};