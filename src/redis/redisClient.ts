import { createClient, RedisClientType } from "redis";
import config from "../config";
import { logger } from "logger/logger";

class RedisClient {
  private clientInstance: RedisClientType;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private retryCount: number = 0;
  private maxRetries: number = 1; // Reduced from 3 for faster failure
  private retryDelay: number = 1000; // 1 second
  private lastError: string | null = null;
  private nextRetryAllowedAt: number = 0;
  private readonly COOLDOWN_PERIOD = 10 * 60 * 1000; // 10 minutes cooldown

  constructor() {
    this.clientInstance = createClient({
      url:
        process.env.REDIS_URL ||
        `redis://${config.redis.host}:${config.redis.port}`,
      password: config.redis.password || undefined,
      socket: {
        connectTimeout: 5000, // Reduced from 60 seconds
        noDelay: true, // Disable Nagle's algorithm for lower latency
        reconnectStrategy: (retries: number) => {
          this.retryCount = retries;
          console.warn(
            `Redis reconnection attempt ${this.retryCount}/${this.maxRetries}`
          );

          if (this.retryCount > this.maxRetries) {
            console.error("Redis max reconnection attempts reached");
            return false; // Stop reconnecting
          }

          // Exponential backoff using configured base delay, max 5 seconds.
          return Math.min(this.retryCount * this.retryDelay, 5000);
        },
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.clientInstance.on("error", (err: Error) => {
      logger.warn(`Redis client error: ${err.message}`);
      this.isConnected = false;
      this.lastError = err.message;
    });

    this.clientInstance.on("connect", () => {
      logger.info("Redis client connected");
      this.isConnected = true;
      this.retryCount = 0;
      this.lastError = null;
    });

    this.clientInstance.on("disconnect", () => {
      logger.warn("Redis client disconnected");
      this.isConnected = false;
    });

    this.clientInstance.on("ready", () => {
      logger.info("Redis client ready");
      this.isConnected = true;
      this.lastError = null;
    });

    this.clientInstance.on("end", () => {
      logger.warn("Redis client connection ended");
      this.isConnected = false;
    });
  }

  // Getter for the client instance
  get client(): RedisClientType {
    return this.clientInstance;
  }

  getStatus() {
    return {
      enabled: config.cache.enabled,
      connected: this.isConnected && this.clientInstance.isReady,
      lastError: this.lastError,
    };
  }

  isAvailable(): boolean {
    return this.getStatus().connected;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    if (Date.now() < this.nextRetryAllowedAt) {
      const remaining = Math.ceil((this.nextRetryAllowedAt - Date.now()) / 1000);
      throw new Error(`Redis is in cooldown. Skipping connection attempt. Retry allowed in ${remaining}s`);
    }

    this.connectionPromise = this.attemptConnection();

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async attemptConnection(): Promise<void> {
    try {
      await this.clientInstance.connect();
      logger.info("Connected to Redis");
      this.lastError = null;
    } catch (error) {
      this.isConnected = false;
      // Activate circuit breaker: don't try again for COOLDOWN_PERIOD
      this.nextRetryAllowedAt = Date.now() + this.COOLDOWN_PERIOD;
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.warn(`Redis connection failed. Entering cooldown for ${this.COOLDOWN_PERIOD / 60000} minutes.`);
      throw error;
    }
  }

  async ensureConnected(): Promise<void> {
    if (!config.cache.enabled) {
      throw new Error("Redis cache is disabled");
    }

    if (!this.isConnected) {
      await this.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.clientInstance.isOpen) {
      await this.clientInstance.disconnect();
    }

    this.isConnected = false;
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      if (!config.cache.enabled) {
        return true;
      }

      if (!this.clientInstance.isOpen) {
        return false;
      }

      await this.ensureConnected();
      await this.clientInstance.ping();
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  async set(
    key: string,
    value: string,
    expiryInSec: number = 3600,
  ): Promise<void> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      await this.clientInstance.setEx(key, expiryInSec, value);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      return await this.clientInstance.get(key);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      await this.clientInstance.del(key);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      // Only ensure connection if not already connected
      if (!this.isConnected) {
        await this.ensureConnected();
      }
      return await this.clientInstance.keys(pattern);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // Graceful shutdown
  async gracefulShutdown(): Promise<void> {
    logger.info("Shutting down Redis connection...");
    await this.disconnect();
  }
}

const redisClient = new RedisClient();

export default redisClient;
