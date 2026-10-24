import crypto from "crypto";
import config from "../../config";
import { logger } from "../../logger/logger";

/**
 * Airtel "Callback With Authentication": the callback body is
 *   { "transaction": { ... }, "hash": "<base64>" }
 * and hash = Base64( HMAC-SHA256( callback JSON without the hash member, Hash Key ) ),
 * where the Hash Key is shown in the app's Security settings.
 *
 * Airtel's documentation sample does not reproduce its own hash, so the exact hashed
 * text is unconfirmed. Two candidates are tried: the raw body with the hash member cut
 * out (byte-exact), and the compact JSON of the parsed `transaction` object.
 */

export type AirtelCallbackAuthMode = "off" | "log" | "enforce";

export function getAirtelCallbackAuthMode(): AirtelCallbackAuthMode {
  const raw = String(config.airtel.callback_auth_mode || "log").toLowerCase();
  const mode: AirtelCallbackAuthMode = raw === "off" || raw === "enforce" ? raw : "log";
  if (mode === "enforce" && !config.airtel.callback_hash_key) {
    logger.error("[Airtel Callback Auth] AIRTEL_CALLBACK_AUTH_MODE=enforce but AIRTEL_CALLBACK_HASH_KEY is empty; falling back to log mode");
    return "log";
  }
  return mode;
}

/** Removes the `"hash": "..."` member (and its comma) from a raw JSON string, keeping everything else byte-exact. */
export function stripHashMember(raw: string): string | null {
  const trailing = /,\s*"hash"\s*:\s*"[^"]*"\s*(?=\})/; // ..., "hash":"x"}
  if (trailing.test(raw)) return raw.replace(trailing, "");
  const leading = /"hash"\s*:\s*"[^"]*"\s*,\s*/; // {"hash":"x", ...
  if (leading.test(raw)) return raw.replace(leading, "");
  return null;
}

const hmacBase64 = (text: string, key: string) =>
  crypto.createHmac("sha256", key).update(text, "utf8").digest("base64");

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export interface AirtelHashCheck {
  present: boolean;
  valid: boolean;
  scheme?: "raw-without-hash" | "compact-transaction";
}

export function verifyAirtelCallbackHash(rawBody: string | undefined, body: any, key: string): AirtelHashCheck {
  const received = typeof body?.hash === "string" ? body.hash.trim() : "";
  if (!received) return { present: false, valid: false };
  if (!key) return { present: true, valid: false };

  if (rawBody) {
    const stripped = stripHashMember(rawBody);
    if (stripped !== null && safeEqual(hmacBase64(stripped, key), received)) {
      return { present: true, valid: true, scheme: "raw-without-hash" };
    }
  }

  if (body?.transaction && typeof body.transaction === "object") {
    const compact = JSON.stringify({ transaction: body.transaction });
    if (safeEqual(hmacBase64(compact, key), received)) {
      return { present: true, valid: true, scheme: "compact-transaction" };
    }
  }

  return { present: true, valid: false };
}
