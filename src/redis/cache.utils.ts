import config from "config";

type TCacheSegment = string | number | boolean;

const normalizeSegment = (segment: TCacheSegment | null | undefined) => {
  return String(segment ?? "").trim().replace(/\s+/g, "_");
};

export const buildCacheKey = (...segments: Array<TCacheSegment | null | undefined>) => {
  return [config.cache.prefix, ...segments]
    .map(normalizeSegment)
    .filter(Boolean)
    .join(":");
};

export const buildCachePattern = (...segments: Array<TCacheSegment | null | undefined>) => {
  return [config.cache.prefix, ...segments]
    .map((segment) => (segment === "*" ? "*" : normalizeSegment(segment)))
    .filter(Boolean)
    .join(":");
};

export const getSecondsUntil = (date: Date | string, minimumSeconds: number = 1) => {
  const target = typeof date === "string" ? new Date(date) : date;
  const ttl = Math.ceil((target.getTime() - Date.now()) / 1000);

  return Math.max(minimumSeconds, ttl);
};