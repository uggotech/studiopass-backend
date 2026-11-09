import config from "config";
import AfricasTalking from "africastalking";
import { logger } from "logger/logger";

// ─── Country List ─────────────────────────────────────────────────────────────
// Countries supported via Africa's Talking SMS gateway.
// If user's countryName matches one of these (case-insensitive), AT is used.
// Otherwise, Twilio is used as the fallback for international SMS.

export const AFRICAS_TALKING_COUNTRIES: string[] = [
  "Nigeria",
  "Kenya",
  "Uganda",
  "Tanzania",
  "Ghana",
  "Cameroon",
  "Zambia",
  "Zimbabwe",
  "Malawi",
  "Rwanda",
  "Ethiopia",
  "South Africa",
  "Mozambique",
  "Ivory Coast",
  "Senegal",
  "Somalia",
  "Botswana",
  "Lesotho",
  "Eswatini",
  "Namibia",
];

export const isAfricasTalkingCountry = (countryName: string): boolean => {
  return AFRICAS_TALKING_COUNTRIES.some(
    (c) => c.toLowerCase() === countryName.trim().toLowerCase(),
  );
};

// ─── Client ───────────────────────────────────────────────────────────────────

let atClient: ReturnType<typeof AfricasTalking> | null = null;

const getAtClient = () => {
  if (!atClient) {
    atClient = AfricasTalking({
      apiKey: config.africas_talking.api_key,
      username: config.africas_talking.username,
    });
  }
  return atClient;
};

// ─── SMS Sender ───────────────────────────────────────────────────────────────

/**
 * Optional branded sender ID (AT_SENDER_ID). The SDK rejects an empty `from`, so the
 * field is only sent when a sender ID is set; otherwise Africa's Talking uses its default.
 */
const smsSenderOption = (): { from: string } => {
  const senderId = (process.env.AT_SENDER_ID || "").trim();
  // The SDK types mark `from` as required, but it accepts the field being absent
  return (senderId ? { from: senderId } : {}) as { from: string };
};

export interface SmsSendResult {
  ok: boolean;
  detail?: string;
}

/**
 * Sends one plain SMS through Africa's Talking using the default sender ID.
 * Africa's Talking answers HTTP 2xx even when a recipient is rejected, so the
 * per-recipient status is checked (statusCode 100-102 = accepted).
 * Never throws: callers (e.g. payment receipts) must not fail because an SMS failed.
 */
export const sendSms = async (phone: string, message: string): Promise<SmsSendResult> => {
  try {
    const at = getAtClient();
    const result: any = await at.SMS.send({ to: [phone], message, ...smsSenderOption() });
    const recipient = result?.SMSMessageData?.Recipients?.[0];
    const code = Number(recipient?.statusCode);
    if (code >= 100 && code <= 102) {
      // The messageId lets the later delivery report ([AT SMS Delivery]) be matched to this SMS
      logger.info(`[AT SMS] Accepted SMS to ${phone}: messageId=${recipient?.messageId}, status=${recipient?.status}`);
      return { ok: true, detail: recipient?.messageId };
    }
    const detail = recipient?.status || result?.SMSMessageData?.Message || "Unknown Africa's Talking response";
    logger.warn(`[AT SMS] SMS to ${phone} not accepted: ${detail}`);
    return { ok: false, detail };
  } catch (error: any) {
    logger.error(`[AT SMS] Failed to send SMS to ${phone}: ${error?.message || error}`);
    return { ok: false, detail: error?.message || "SMS request failed" };
  }
};

export const sendAtOtp = async (phone: string, otp: string): Promise<void> => {
  const message = `Your StudioPass verification code is: ${otp}. Valid for 30 minutes. Do not share this code.`;

  try {
    const at = getAtClient();
    const sms = at.SMS;

    const result = await sms.send({
      to: [phone],
      message,
      ...smsSenderOption(), // empty = AT default sender
    });

    logger.info(`[AT SMS] Sent OTP to ${phone}`, { result });
  } catch (error) {
    logger.error(`[AT SMS] Failed to send OTP to ${phone}`, { error });
    throw error;
  }
};
