import crypto from "crypto";
import config from "../../config";
import { logger } from "../../logger/logger";

interface CachedToken {
  token: string;
  expiresAt: number;
}

let inMemoryTokenCache: CachedToken | null = null;

/**
 * Generates an internal identifier with prefix (e.g. COL1729000000ABCDEF or TXN...).
 */
export function generateAirtelId(prefix: string): string {
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${ts}${rand}`;
}

/**
 * Retrieves a valid OAuth2 access token for Airtel OpenAPI, caching in Redis or memory.
 */
export async function getAirtelAccessToken(): Promise<string | null> {
  const now = Date.now();

  // 1. Try Redis cache first
  try {
    const { default: redisClient } = await import("../../redis/redisClient");
    const cached = await redisClient.get("airtel:oauth:token");
    if (cached) {
      logger.info("[Airtel OpenAPI] Using cached OAuth token from Redis");
      return cached;
    }
  } catch {
    // If Redis is unavailable, check in-memory cache
    if (inMemoryTokenCache && inMemoryTokenCache.expiresAt > now) {
      logger.info("[Airtel OpenAPI] Using cached OAuth token from memory");
      return inMemoryTokenCache.token;
    }
  }

  // 2. Request new token from Airtel OpenAPI
  const clientId = config.airtel.client_id;
  const clientSecret = config.airtel.client_secret;
  const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

  try {
    logger.info(`[Airtel OpenAPI] Requesting fresh OAuth token from ${config.airtel.token_url}`);
    const response = await fetch(config.airtel.token_url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[Airtel OpenAPI] Token request failed with HTTP ${response.status}:`, errText);
      return null;
    }

    const data: any = await response.json();
    const token = data.access_token;
    const expiresIn = Number(data.expires_in) || 3600;

    if (!token) {
      logger.error("[Airtel OpenAPI] Token response missing access_token:", data);
      return null;
    }

    const ttlSeconds = Math.max(60, expiresIn - 60);
    logger.info(`[Airtel OpenAPI] Successfully acquired fresh token. Expires in ${expiresIn}s, cache TTL ${ttlSeconds}s`);

    // Cache in Redis
    try {
      const { default: redisClient } = await import("../../redis/redisClient");
      await redisClient.set("airtel:oauth:token", token, ttlSeconds);
    } catch {
      inMemoryTokenCache = {
        token,
        expiresAt: now + ttlSeconds * 1000,
      };
    }

    return token;
  } catch (error) {
    logger.error("[Airtel OpenAPI] Failed to fetch access token:", error);
    return null;
  }
}

/**
 * Initiates C2B collection request to Airtel OpenAPI.
 */
export async function initiateAirtelCollection(params: {
  msisdn: string; // Strictly 9 digits: 7XXXXXXXX
  amount: number;
  transactionId: string;
  reference: string;
  narration: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const { msisdn, amount, transactionId, reference, narration } = params;

  const token = await getAirtelAccessToken();
  if (!token) {
    logger.warn(`[Airtel OpenAPI] Cannot initiate collection: failed to retrieve access token`);
    return {
      success: false,
      error: "Unable to retrieve Airtel access token. Please try again later.",
    };
  }

  const payload = {
    reference,
    subscriber: {
      country: config.airtel.country,
      currency: config.airtel.currency,
      msisdn,
    },
    transaction: {
      id: transactionId,
      amount,
      country: config.airtel.country,
      currency: config.airtel.currency,
      reason: narration || "StudioPass Credits",
    },
    merchant: {
      name: config.airtel.application_name,
      code: config.airtel.merchant_code,
    },
    callback: config.airtel.callback_url,
  };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Country": config.airtel.country,
    "X-Currency": config.airtel.currency,
  };

  logger.info(`[Airtel OpenAPI] Initiating collection:
  • URL: ${config.airtel.collection_url}
  • MSISDN: ${msisdn}
  • Amount: ${amount} ${config.airtel.currency}
  • Transaction ID: ${transactionId}
  • Reference: ${reference}
  • Payload: ${JSON.stringify(payload, null, 2)}`);

  const startTime = Date.now();
  try {
    const response = await fetch(config.airtel.collection_url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    const elapsed = Date.now() - startTime;
    const text = await response.text();
    let responseData: any = {};
    try {
      responseData = JSON.parse(text);
    } catch {
      responseData = { raw: text };
    }

    logger.info(`[Airtel OpenAPI] Response HTTP ${response.status} (${elapsed}ms):`, JSON.stringify(responseData, null, 2));

    if (response.ok) {
      logger.info(`[Airtel OpenAPI] Collection push accepted for txId: ${transactionId}`);
      return { success: true, data: responseData };
    } else {
      const errorMsg = responseData.message || responseData.status?.message || `Airtel responded with HTTP ${response.status}`;
      logger.warn(`[Airtel OpenAPI] Collection rejected for txId: ${transactionId}. Reason: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        data: responseData,
      };
    }
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    logger.error(`[Airtel OpenAPI] Collection error for txId ${transactionId} after ${elapsed}ms:`, err);
    return { success: false, error: err.message || "Failed to connect to Airtel OpenAPI" };
  }
}
