import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";
import config from "../../config";
import { logger } from "../../logger/logger";
import { PayLeoCallbackParsed, PayLeoForwardedCallback } from "./payment.interface";

export function isPayLeoConfigured(): boolean {
  const { merchant_code, consumer_key, consumer_secret } = config.payleo;
  return Boolean(merchant_code && consumer_key && consumer_secret);
}

/**
 * Generates a 15-digit numeric transaction ID formatted for PayLeo.
 * Format: 15 numeric digits (matches str_pad(mt_rand(...), 15, '0') in PHP).
 */
export function generatePayLeoTransactionId(): string {
  const min = 100000000000000n;
  const max = 999999999999999n;
  const range = max - min + 1n;
  const randomBytes = crypto.randomBytes(8);
  const randomBigInt = randomBytes.readBigUInt64BE(0);
  const result = min + (randomBigInt % range);
  return result.toString();
}

/**
 * Generates HMAC-SHA256 auth_signature according to PayLeo specification:
 * hash_hmac('sha256', signatureUrl + "&" + msisdn + "&" + amount + "&" + merchantCode + "&" + transactionId + "&" + narration, consumerSecret)
 */
export function generatePayLeoSignature(
  msisdn: string,
  amount: number | string,
  transactionId: string,
  narration: string,
  opts: { signatureUrl?: string; merchantCode?: string; consumerSecret?: string } = {},
): string {
  const signatureUrl = opts.signatureUrl ?? config.payleo.signature_url;
  const merchantCode = opts.merchantCode ?? config.payleo.merchant_code;
  const consumerSecret = opts.consumerSecret ?? config.payleo.consumer_secret;

  const data = `${signatureUrl}&${msisdn}&${amount}&${merchantCode}&${transactionId}&${narration}`;
  return crypto.createHmac("sha256", consumerSecret).update(data).digest("hex");
}

/**
 * PayLeo can answer HTTP 200 with {"status":"FAILED","code":204,...} (MerchantsAPIExtension.pdf §2.3.3).
 * Treat the push as failed when the body explicitly says so; documented success is {"status":"OK","code":100}.
 */
export function isPayLeoPushRejected(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  const status = String(body.status ?? "").toUpperCase();
  if (["FAILED", "FAIL", "ERROR", "REJECTED", "FALSE"].includes(status)) return true;
  if (body.status === false || body.success === false) return true;
  return Number(body.code) === 204;
}

/**
 * Initiates C2B deposit push via PayLeo API for MTN Mobile Money.
 */
export async function initiatePayLeoDeposit(params: {
  msisdn: string; // 2567XXXXXXXX
  amount: number;
  transactionId: string;
  narration: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const { msisdn, amount, transactionId, narration } = params;
  const merchantCode = config.payleo.merchant_code;
  const consumerKey = config.payleo.consumer_key;

  const auth_signature = generatePayLeoSignature(msisdn, amount, transactionId, narration);

  const payload = {
    msisdn,
    amount: String(amount),
    merchantCode,
    transactionId,
    consumerKey,
    narration,
    auth_signature,
  };

  logger.info(`[PayLeo Push] >>> Deposit push: txId=${transactionId}, msisdn=${msisdn}, amount=${amount} UGX, merchant=${merchantCode}`);

  const startTime = Date.now();
  try {
    const response = await fetch(config.payleo.deposit_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

    logger.info(`[PayLeo Push] <<< HTTP ${response.status} (${elapsed}ms) txId=${transactionId} body=${JSON.stringify(responseData)}`);

    if (response.ok && !isPayLeoPushRejected(responseData)) {
      return { success: true, data: responseData };
    }

    const errorMsg = responseData.message || `PayLeo responded with HTTP ${response.status}`;
    logger.warn(`[PayLeo Push] ❌ Deposit push rejected for txId ${transactionId}: ${errorMsg}`);
    return { success: false, error: errorMsg, data: responseData };
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    logger.error(`[PayLeo Push] 💥 Network/Gateway Exception for txId ${transactionId} after ${elapsed}ms:`, err);
    return { success: false, error: err.message || "Failed to connect to PayLeo API" };
  }
}

/**
 * Parses inbound XML callback from PayLeo securely without external entities.
 */
export function parsePayLeoXmlCallback(xmlBody: string): PayLeoCallbackParsed | null {
  if (!xmlBody || typeof xmlBody !== "string") {
    logger.warn("[PayLeo Callback] Inbound XML is empty or not a string");
    return null;
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xmlBody)) {
    logger.warn("[PayLeo Callback] XML with DOCTYPE/ENTITY declarations rejected");
    return null;
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      trimValues: true,
      processEntities: false, // Prevents XXE injection
      parseTagValue: false, // Keep transactionId/amount as strings (no number coercion)
    });

    const parsed = parser.parse(xmlBody.trim());
    if (!parsed || !parsed.request) {
      logger.warn("[PayLeo Callback] Root node <request> missing in XML payload");
      return null;
    }

    const req = parsed.request;
    const result: PayLeoCallbackParsed = {
      method: String(req.method || ""),
      msisdn: String(req.msisdn || ""),
      transactionId: String(req.transactionId || ""),
      referenceId: req.referenceId != null ? String(req.referenceId) : undefined,
      amount: String(req.amount || ""),
      client_transaction: req.client_transaction != null ? String(req.client_transaction) : undefined,
      narration: req.narration != null ? String(req.narration) : undefined,
      message: req.message != null ? String(req.message) : undefined,
    };
    logger.info(`[PayLeo Callback] Parsed: method="${result.method}", txId="${result.transactionId}", clientTx="${result.client_transaction || "none"}", amount="${result.amount}"`);
    return result;
  } catch (error) {
    logger.error("[PayLeo Callback] XML Parse Error:", error);
    return null;
  }
}

/**
 * Maps the JSON forwarded by the client's payleo_callback.php into the XML callback shape.
 */
export function fromForwardedPayLeoCallback(body: PayLeoForwardedCallback): PayLeoCallbackParsed | null {
  if (!body || typeof body !== "object" || !body.transactionId) return null;
  return {
    method: String(body.method || (body.status === "SUCCESS" ? "receivePayment" : "notifyFailedPayment")),
    msisdn: String(body.msisdn || ""),
    transactionId: String(body.transactionId),
    referenceId: body.referenceId ? String(body.referenceId) : undefined,
    amount: String(body.amount || ""),
    client_transaction: body.client_transaction ? String(body.client_transaction) : undefined,
    narration: body.narration ? String(body.narration) : undefined,
    message: body.message ? String(body.message) : undefined,
  };
}

/**
 * Verifies X-StudioPass-Signature = hex(HMAC-SHA256(rawJson, PAYLEO_FORWARD_SECRET)),
 * exactly as computed in by client/working payleo api/payleo_callback.php.
 */
export function verifyPayLeoForwardSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = config.payleo.forward_secret;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Generates the required True African XML response string:
 * <?xml version="1.0" encoding="UTF-8"?><request><code>200</code><message>Transaction received</message></request>
 */
export function buildPayLeoXmlResponse(code: number, message: string): string {
  const safeMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<request><code>${code}</code><message>${safeMessage}</message></request>`;
}
