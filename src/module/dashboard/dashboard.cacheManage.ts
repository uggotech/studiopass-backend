import cacheService from "../../redis/cacheService";
import { buildCacheKey } from "../../redis/cache.utils";

const STATS_TTL = 120; // 2 minutes

const buildStatsKey = (role: string, scopeId: string) =>
  buildCacheKey("dashboard", "stats", role, scopeId);

export const DashboardCache = {
  getStats: async (role: string, scopeId: string) => {
    try {
      return await cacheService.getCache<any>(buildStatsKey(role, scopeId));
    } catch {
      return null;
    }
  },

  setStats: async (role: string, scopeId: string, data: any) => {
    try {
      await cacheService.setCache(buildStatsKey(role, scopeId), data, STATS_TTL);
    } catch {}
  },

  invalidateAll: async () => {
    try {
      await cacheService.invalidateByPattern("studiopass:dashboard:stats:*");
    } catch {}
  },
};
