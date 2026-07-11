import cacheService from "../../redis/cacheService";
import { buildCacheKey, buildCachePattern } from "../../redis/cache.utils";

const TTL = {
  country: 86400, // 24h - country config rarely changes
  countryList: 3600, // 1h
};

const KEYS = {
  country: (countryId: string) => buildCacheKey("country", "detail", countryId),
  countryByCode: (code: string) => buildCacheKey("country", "code", code),
  countryList: () => buildCacheKey("country", "list"),
  pattern: () => buildCachePattern("country", "*"),
};

const getCountry = (countryId: string) => {
  return cacheService.getCache<any>(KEYS.country(countryId));
};

const setCountry = (countryId: string, data: any) => {
  return cacheService.setCache(KEYS.country(countryId), data, TTL.country);
};

const getCountryByCode = (code: string) => {
  return cacheService.getCache<any>(KEYS.countryByCode(code));
};

const setCountryByCode = (code: string, data: any) => {
  return cacheService.setCache(KEYS.countryByCode(code), data, TTL.country);
};

const getCountryList = () => {
  return cacheService.getCache<any[]>(KEYS.countryList());
};

const setCountryList = (data: any[]) => {
  return cacheService.setCache(KEYS.countryList(), data, TTL.countryList);
};

const invalidateAll = () => {
  cacheService.invalidateByPattern(KEYS.pattern());
};

export const CountryCache = {
  getCountry,
  setCountry,
  getCountryByCode,
  setCountryByCode,
  getCountryList,
  setCountryList,
  invalidateAll,
  KEYS,
  TTL,
};
