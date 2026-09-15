import cacheService from "../../redis/cacheService";
import { buildCacheKey, buildCachePattern } from "../../redis/cache.utils";

const TTL = {
  station: 300, // 5min
  stationList: 45, // 45s — live show/follow changes frequently
};

const KEYS = {
  station: (stationId: string) => buildCacheKey("station", "detail", stationId),
  stationList: (partnerId?: string) =>
    buildCacheKey("station", "list", partnerId || "all"),
  pattern: () => buildCachePattern("station", "*"),
};

const getStation = (stationId: string) => {
  return cacheService.getCache<any>(KEYS.station(stationId));
};

const setStation = (stationId: string, data: any) => {
  return cacheService.setCache(KEYS.station(stationId), data, TTL.station);
};

const invalidateStation = (stationId: string) => {
  cacheService.deleteCache(KEYS.station(stationId));
  // Also invalidate list caches since the station may appear in lists
  cacheService.invalidateByPattern(buildCachePattern("station", "list", "*"));
};

/** Wipe all public-station list entries (follow/station writes). */
const invalidateAllLists = () => {
  cacheService.invalidateByPattern(buildCachePattern("station", "list", "*"));
};

const getStationList = (partnerId?: string) => {
  return cacheService.getCache<any>(KEYS.stationList(partnerId));
};

const setStationList = (partnerId: string | undefined, data: any) => {
  return cacheService.setCache(KEYS.stationList(partnerId), data, TTL.stationList);
};

export const StationCache = {
  getStation,
  setStation,
  invalidateStation,
  invalidateAllLists,
  getStationList,
  setStationList,
  KEYS,
  TTL,
};
