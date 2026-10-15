import crypto from "crypto";
import { XMLParser } from "fast-xml-parser";
import config from "../../config";
import { logger } from "../../logger/logger";
import { PayLeoCallbackParsed } from "./payment.interface";

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
): string {
  const signatureUrl = config.payleo.signature_url;
  const merchantCode = config.payleo.merchant_code;
  const consumerSecret = config.payleo.consumer_secret;

  const data = `${signatureUrl}&${msisdn}&${amount}&${merchantCode}&${transactionId}&${narration}`;
  const signature = crypto.createHmac("sha256", consumerSecret).update(data).digest("hex");
  logger.info(`[PayLeo Signature] Generating HMAC-SHA256 signature:
  • Signature URL: ${signatureUrl}
  • MSISDN: ${msisdn}
  • Amount: ${amount}
  • Merchant Code: ${merchantCode}
  • Transaction ID: ${transactionId}
  • Narration: "${narration}"
  • Base String: "${data}"
  • Resulting Signature: "${signature}"`);
  return signature;
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

  const auth_signature = generatePayLeoSignature(
    msisdn,
    amount,
    transactionId,
    narration,
  );

  const payload = {
    msisdn,
    amount: String(amount),
    merchantCode,
    transactionId,
    consumerKey,
    narration,
    auth_signature,
  };

  logger.info(`[PayLeo Push] >>> OUTGOING DEPOSIT PUSH REQUEST >>>
  • URL: ${config.payleo.deposit_url}
  • Transaction ID: ${transactionId}
  • MSISDN: ${msisdn}
  • Amount: ${amount} UGX
  • Merchant Code: ${merchantCode}
  • Consumer Key: ${consumerKey}
  • Narration: "${narration}"
  • Payload: ${JSON.stringify(payload, null, 2)}`);

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

    logger.info(`[PayLeo Push] <<< GATEWAY RESPONSE RECEIVED <<< (${elapsed}ms)
  • HTTP Status: ${response.status} ${response.statusText}
  • Body: ${JSON.stringify(responseData, null, 2)}`);

    if (response.ok) {
      logger.info(`[PayLeo Push] ✅ True African gateway accepted deposit push for txId: ${transactionId}`);
      return { success: true, data: responseData };
    } else {
      const errorMsg = responseData.message || `PayLeo responded with HTTP ${response.status}`;
      logger.warn(`[PayLeo Push] ❌ True African gateway rejected deposit push for txId: ${transactionId}. Reason: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        data: responseData,
      };
    }
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
  logger.info(`[PayLeo Callback] Inbound Raw XML (${xmlBody?.length || 0} bytes):\n${xmlBody}`);
  if (!xmlBody || typeof xmlBody !== "string") {
    logger.warn("[PayLeo Callback] Inbound XML is empty or not a string");
    return null;
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      trimValues: true,
      processEntities: false, // Prevents XXE injection
    });

    const parsed = parser.parse(xmlBody.trim());
    if (!parsed || !parsed.request) {
      logger.warn(`[PayLeo Callback] Root node <request> missing in XML payload: ${JSON.stringify(parsed)}`);
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
    logger.info(`[PayLeo Callback] Successfully parsed XML callback fields:
  • Method: "${result.method}"
  • Transaction ID: "${result.transactionId}"
  • Reference ID: "${result.referenceId || "none"}"
  • MSISDN: "${result.msisdn}"
  • Amount: "${result.amount}"
  • Client Transaction: "${result.client_transaction || "none"}"
  • Message: "${result.message || "none"}"`);
    return result;
  } catch (error) {
    logger.error("[PayLeo Callback] XML Parse Error:", error);
    return null;
  }
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

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<request><code>${code}</code><message>${safeMessage}</message></request>`;
  logger.info(`[PayLeo Callback] Outgoing Acknowledgment XML to True African (code: ${code}):\n${xml}`);
  return xml;
}
