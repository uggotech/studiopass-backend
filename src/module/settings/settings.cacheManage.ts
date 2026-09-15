import { logger } from "../../logger/logger";

const SETTINGS_CACHE_KEY = "settings:security";
const SETTINGS_CACHE_TTL = 300; // 5 minutes

let redisClient: any = null;

const getRedis = async () => {
  if (!redisClient) {
    try {
      const mod = await import("../../redis/redisClient");
      redisClient = mod.default;
    } catch {
      return null;
    }
  }
  return redisClient;
};

export const SettingsCache = {
  async get(): Promise<Record<string, any> | null> {
    const redis = await getRedis();
    if (!redis) return null;
    try {
      const cached = await redis.get(SETTINGS_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  },

  async set(data: Record<string, any>): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;
    try {
      await redis.set(SETTINGS_CACHE_KEY, JSON.stringify(data), SETTINGS_CACHE_TTL);
    } catch (err) {
      logger.warn("[SettingsCache] Failed to set cache:", err);
    }
  },

  async invalidate(): Promise<void> {
    const redis = await getRedis();
    if (!redis) return;
    try {
      await redis.del(SETTINGS_CACHE_KEY);
    } catch (err) {
      logger.warn("[SettingsCache] Failed to invalidate cache:", err);
    }
  },
};
