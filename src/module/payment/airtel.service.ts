import crypto from "crypto";
import config from "../../config";
import { logger } from "../../logger/logger";

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_CACHE_KEY = "airtel:oauth:token";
let inMemoryTokenCache: CachedToken | null = null;

export function isAirtelConfigured(): boolean {
  const { client_id, client_secret, merchant_code } = config.airtel;
  return Boolean(client_id && client_secret && merchant_code);
}

/**
 * Generates an internal identifier with prefix, same 19-char shape as the client's
 * working dashboard.php: PREFIX + unix seconds + 6 hex (e.g. TXN1779114705A2A8F1).
 */
export function generateAirtelId(prefix: string): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}${ts}${rand}`;
}

async function clearAirtelToken() {
  inMemoryTokenCache = null;
  try {
    const { default: redisClient } = await import("../../redis/redisClient");
    await redisClient.del(TOKEN_CACHE_KEY);
  } catch {}
}

/**
 * Retrieves a valid OAuth2 access token for Airtel OpenAPI, caching in Redis or memory.
 */
export async function getAirtelAccessToken(): Promise<string | null> {
  const now = Date.now();

  // 1. Try Redis cache first
  try {
    const { default: redisClient } = await import("../../redis/redisClient");
    const cached = await redisClient.get(TOKEN_CACHE_KEY);
    if (cached) return cached;
  } catch {
    // If Redis is unavailable, check in-memory cache
    if (inMemoryTokenCache && inMemoryTokenCache.expiresAt > now) {
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
      logger.error("[Airtel OpenAPI] Token response missing access_token");
      return null;
    }

    const ttlSeconds = Math.max(60, expiresIn - 60);
    logger.info(`[Airtel OpenAPI] Acquired fresh token. Expires in ${expiresIn}s, cache TTL ${ttlSeconds}s`);

    // Cache in Redis
    try {
      const { default: redisClient } = await import("../../redis/redisClient");
      await redisClient.set(TOKEN_CACHE_KEY, token, ttlSeconds);
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
 * Calls an Airtel endpoint with a bearer token. On HTTP 401 the cached token is
 * cleared and the call is retried once with a fresh token.
 */
async function airtelFetch(url: string, init: { method: string; body?: string }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAirtelAccessToken();
    if (!token) return null;

    const response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Country": config.airtel.country,
        "X-Currency": config.airtel.currency,
      },
      body: init.body,
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 401 && attempt === 0) {
      logger.warn("[Airtel OpenAPI] HTTP 401, clearing cached token and retrying once");
      await clearAirtelToken();
      continue;
    }

    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { response, data };
  }
  return null;
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

  logger.info(`[Airtel OpenAPI] Initiating collection: txId=${transactionId}, ref=${reference}, msisdn=${msisdn}, amount=${amount} ${config.airtel.currency}`);

  const startTime = Date.now();
  try {
    const result = await airtelFetch(config.airtel.collection_url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!result) {
      return { success: false, error: "Unable to retrieve Airtel access token. Please try again later." };
    }

    const { response, data: responseData } = result;
    const elapsed = Date.now() - startTime;
    logger.info(`[Airtel OpenAPI] Response HTTP ${response.status} (${elapsed}ms) txId=${transactionId} body=${JSON.stringify(responseData)}`);

    // Airtel can return HTTP 200 with status.success=false
    if (response.ok && responseData?.status?.success !== false) {
      return { success: true, data: responseData };
    }

    const errorMsg = responseData.status?.message || responseData.message || `Airtel responded with HTTP ${response.status}`;
    logger.warn(`[Airtel OpenAPI] Collection rejected for txId ${transactionId}: ${errorMsg}`);
    return { success: false, error: errorMsg, data: responseData };
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    logger.error(`[Airtel OpenAPI] Collection error for txId ${transactionId} after ${elapsed}ms:`, err);
    return { success: false, error: err.message || "Failed to connect to Airtel OpenAPI" };
  }
}

export type AirtelTxState = "SUCCESS" | "FAILED" | "PENDING" | "UNKNOWN";

const mapAirtelTxStatus = (statusCode: string): AirtelTxState => {
  if (statusCode === "TS") return "SUCCESS";
  if (statusCode === "TF" || statusCode === "TE") return "FAILED";
  if (statusCode === "TIP" || statusCode === "TA" || statusCode === "TI") return "PENDING";
  return "UNKNOWN";
};

// ─── Disbursements (B2C payouts to Airtel wallets) ──────────────────────────
// Airtel Disbursement-APIs v2: POST /standard/v2/disbursements/, enquiry
// GET /standard/v2/disbursements/{id}?transactionType=B2C

export function isAirtelDisbursementConfigured(): boolean {
  // The PIN-encryption key is fetched from Airtel, so only credentials + PIN are required
  return Boolean(config.airtel.client_id && config.airtel.client_secret && config.payout.airtel_disbursement_pin);
}

/**
 * Airtel requires the wallet PIN encrypted with an RSA public key
 * (RSA/ECB/PKCS1Padding, 1024-bit, base64). Accepts a PEM or a bare base64 key body.
 */
export function encryptAirtelPin(pin: string, publicKey: string): string {
  let pem = publicKey.trim().replace(/\\n/g, "\n");
  if (!pem.includes("BEGIN")) {
    const body = pem.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") || "";
    pem = `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
  }
  return crypto
    .publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(pin, "utf8"))
    .toString("base64");
}

let cachedEncryptionKey: { key: string; expiresAt: number } | null = null;

/** Airtel's "valid_upto" is "dd-MM-yyyy HH:mm:ss"; returns epoch ms or null if unparsable. */
export function parseAirtelKeyExpiry(validUpto?: string): number | null {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(validUpto || "").trim());
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]));
}

/**
 * RSA public key used to encrypt the payout PIN. Fetched from Airtel
 * (GET /v1/rsa/encryption-keys, key is per customer and expires) and cached for up to
 * an hour; falls back to AIRTEL_DISBURSEMENT_PUBLIC_KEY if Airtel cannot be reached.
 */
export async function getAirtelEncryptionKey(): Promise<string | null> {
  const now = Date.now();
  if (cachedEncryptionKey && cachedEncryptionKey.expiresAt > now) return cachedEncryptionKey.key;

  try {
    const result = await airtelFetch(config.payout.airtel_encryption_keys_url, { method: "GET" });
    const key = result?.data?.data?.key;
    if (result?.response.ok && typeof key === "string" && key.length > 0) {
      const expiry = parseAirtelKeyExpiry(result.data.data.valid_upto);
      // Refresh early: at most 1 hour, and never closer than 12 hours before the stated expiry
      const ttlMs = expiry ? Math.min(60 * 60 * 1000, Math.max(60 * 1000, expiry - now - 12 * 60 * 60 * 1000)) : 60 * 60 * 1000;
      cachedEncryptionKey = { key, expiresAt: now + ttlMs };
      logger.info(`[Airtel Disbursement] Fetched PIN encryption key (id ${result.data.data.key_id}, valid_upto ${result.data.data.valid_upto})`);
      return key;
    }
    logger.warn(`[Airtel Disbursement] Encryption key fetch failed: HTTP ${result?.response.status}`);
  } catch (err) {
    logger.warn("[Airtel Disbursement] Encryption key fetch error:", err);
  }
  return config.payout.airtel_disbursement_public_key || null;
}

export interface AirtelDisbursementResult {
  state: AirtelTxState;
  airtelMoneyId?: string;
  message?: string;
  responseCode?: string;
  raw?: any;
}

// status.response_code values from Disbursement-APIs "Error Codes"
const DISBURSEMENT_SUCCESS_CODE = "DP00900001001";
// Definite failures: Airtel did not (and will not) pay
const DISBURSEMENT_FAILURE_CODES = new Set([
  "DP00900001003", // maximum transaction limit reached for the day
  "DP00900001004", // invalid amount
  "DP00900001005", // failed
  "DP00900001007", // insufficient funds
  "DP00900001009", // invalid initiatee
  "DP00900001010", // user not allowed
  "DP00900001012", // invalid mobile number
  "DP00900001013", // refused
  "DP00900001016", // x-signature and payload did not match
]);
// Not failures: the payout may have happened. Resolve ONLY with the enquiry, never by re-sending.
const DISBURSEMENT_UNSURE_CODES = new Set([
  "DP00900001000", // ambiguous
  "DP00900001006", // processing
  "DP00900001011", // transaction with similar information exists
  "DP00900001014", // timed out
  "DP00900001015", // not found
  "DP00900001017", // duplicate transaction id
]);

/**
 * Decides the outcome of a disbursement response from Airtel's own fields.
 * The transaction status (TS/TF/TIP/TA) wins; otherwise status.response_code decides.
 * `status.success` is never used: Airtel's samples show it false even for TS.
 * Anything unrecognised on HTTP 2xx/5xx stays UNKNOWN so it is checked, not retried.
 */
export function classifyAirtelDisbursement(httpStatus: number, data: any): AirtelDisbursementResult {
  const tx = data?.data?.transaction || {};
  const txStatus = String(tx.status || "").toUpperCase();
  const responseCode = String(data?.status?.response_code || "");
  const base = {
    airtelMoneyId: tx.airtel_money_id as string | undefined,
    message: (tx.message || data?.status?.message) as string | undefined,
    responseCode,
    raw: data,
  };

  if (txStatus === "TS") return { ...base, state: "SUCCESS" };
  if (txStatus === "TF" || txStatus === "TE") return { ...base, state: "FAILED" };
  if (txStatus === "TIP" || txStatus === "TA") return { ...base, state: "PENDING" };

  if (responseCode === DISBURSEMENT_SUCCESS_CODE) return { ...base, state: "SUCCESS" };
  if (DISBURSEMENT_FAILURE_CODES.has(responseCode)) return { ...base, state: "FAILED" };
  if (DISBURSEMENT_UNSURE_CODES.has(responseCode)) return { ...base, state: "PENDING" };

  // No usable status: a 4xx means the request was rejected before any payout
  if (httpStatus >= 400 && httpStatus < 500) return { ...base, state: "FAILED" };
  return { ...base, state: "UNKNOWN" };
}

/**
 * Sends money from the StudioPass disbursement wallet to an Airtel Uganda number.
 * state: SUCCESS / FAILED are final; PENDING / UNKNOWN must be resolved with
 * getAirtelDisbursementStatus (never by sending again).
 */
export async function initiateAirtelDisbursement(params: {
  msisdn: string; // 9 digits: 7XXXXXXXX
  amount: number;
  transactionId: string;
}): Promise<AirtelDisbursementResult> {
  const { msisdn, amount, transactionId } = params;

  let encryptedPin: string;
  try {
    const publicKey = await getAirtelEncryptionKey();
    if (!publicKey) throw new Error("No PIN encryption key available");
    encryptedPin = encryptAirtelPin(config.payout.airtel_disbursement_pin, publicKey);
  } catch (err: any) {
    // Nothing was sent: safe to treat as a definite failure
    logger.error("[Airtel Disbursement] PIN encryption failed:", err);
    return { state: "FAILED", message: "Payout configuration error (PIN encryption)" };
  }

  const payload = {
    payee: { msisdn, currency: config.airtel.currency },
    reference: transactionId,
    pin: encryptedPin,
    transaction: { amount, id: transactionId, type: "B2C" },
  };

  logger.info(`[Airtel Disbursement] >>> txId=${transactionId}, msisdn=${msisdn}, amount=${amount} ${config.airtel.currency}`);

  try {
    const result = await airtelFetch(config.payout.airtel_disbursement_url, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!result) return { state: "FAILED", message: "Unable to retrieve Airtel access token" };

    const { response, data } = result;
    logger.info(`[Airtel Disbursement] <<< HTTP ${response.status} txId=${transactionId} body=${JSON.stringify(data)}`);
    return classifyAirtelDisbursement(response.status, data);
  } catch (err: any) {
    // Timeout / network error after sending: outcome unknown, resolve via enquiry
    logger.error(`[Airtel Disbursement] Exception for txId ${transactionId}:`, err);
    return { state: "UNKNOWN", message: err.message };
  }
}

/** Disbursement enquiry: GET {AIRTEL_DISBURSEMENT_STATUS_URL}{transactionId}?transactionType=B2C */
export async function getAirtelDisbursementStatus(transactionId: string): Promise<AirtelDisbursementResult> {
  try {
    const url = `${config.payout.airtel_disbursement_status_url.replace(/\/?$/, "/")}${encodeURIComponent(transactionId)}?transactionType=B2C`;
    const result = await airtelFetch(url, { method: "GET" });
    if (!result) return { state: "UNKNOWN", message: "No Airtel access token" };

    const { response, data } = result;
    logger.info(`[Airtel Disbursement] Enquiry txId=${transactionId}: HTTP ${response.status}, status="${data?.data?.transaction?.status}", code="${data?.status?.response_code}"`);
    if (!response.ok) return { state: "UNKNOWN", raw: data };

    // An enquiry never concludes "failed" from a missing/unknown code: only an explicit TF/TE does
    const outcome = classifyAirtelDisbursement(response.status, data);
    const txStatus = String(data?.data?.transaction?.status || "").toUpperCase();
    if (outcome.state === "FAILED" && txStatus !== "TF" && txStatus !== "TE" && !DISBURSEMENT_FAILURE_CODES.has(outcome.responseCode || "")) {
      return { ...outcome, state: "UNKNOWN" };
    }
    return outcome;
  } catch (err: any) {
    logger.error(`[Airtel Disbursement] Enquiry failed for txId ${transactionId}:`, err);
    return { state: "UNKNOWN", message: err.message };
  }
}

/**
 * Transaction enquiry: GET /standard/v1/payments/{transactionId}.
 * Used to confirm a callback really is a completed payment before crediting.
 * TS = success, TF/TE = failed/expired, TIP/TA = in progress/ambiguous.
 */
export async function getAirtelTransactionStatus(transactionId: string): Promise<{
  state: AirtelTxState;
  statusCode?: string;
  airtelMoneyId?: string;
  message?: string;
  raw?: any;
}> {
  try {
    const url = `${config.airtel.status_url.replace(/\/?$/, "/")}${encodeURIComponent(transactionId)}`;
    const result = await airtelFetch(url, { method: "GET" });
    if (!result) return { state: "UNKNOWN", message: "No Airtel access token" };

    const { response, data } = result;
    const tx = data?.data?.transaction || {};
    const statusCode = String(tx.status || "").toUpperCase();
    logger.info(`[Airtel OpenAPI] Enquiry txId=${transactionId}: HTTP ${response.status}, status="${statusCode}"`);

    if (!response.ok) return { state: "UNKNOWN", statusCode, raw: data };

    const state = mapAirtelTxStatus(statusCode);

    return {
      state,
      statusCode,
      airtelMoneyId: tx.airtel_money_id,
      message: tx.message,
      raw: data,
    };
  } catch (err: any) {
    logger.error(`[Airtel OpenAPI] Enquiry failed for txId ${transactionId}:`, err);
    return { state: "UNKNOWN", message: err.message };
  }
}
