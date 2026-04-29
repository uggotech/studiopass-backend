/**
 * Twilio Phone OTP — Server-side OTP delivery for international SMS.
 *
 * This module handles SMS delivery via Twilio for countries not covered by Africa's Talking.
 * Twilio provides global SMS coverage for international users.
 *
 * Configure TWILIO_* env vars in .env to enable SMS sending.
 * In development (when credentials are absent), the OTP is logged to console for testing.
 */

import twilio from "twilio";
import config from "config";
import { logger } from "logger/logger";

// ─── Twilio Client ────────────────────────────────────────────────────────────

let twilioClient: ReturnType<typeof twilio> | null = null;

const getTwilioClient = () => {
  const sid = config.twilio.account_sid;
  const token = config.twilio.auth_token;

  if (!sid || !token) {
    return null;
  }

  if (!twilioClient) {
    twilioClient = twilio(sid, token);
  }

  return twilioClient;
};

// ─── OTP Sender ───────────────────────────────────────────────────────────────

/**
 * Send OTP via Twilio for international users (non-Africa's Talking countries).
 *
 * PRODUCTION: Uses Twilio SMS API
 * DEVELOPMENT: Logs OTP to console (when Twilio credentials missing)
 */
export const sendTwilioOtp = async (phone: string, otp: string): Promise<void> => {
  const message = `Your StudioPass verification code is: ${otp}. Valid for 30 minutes. Do not share this code.`;
  const client = getTwilioClient();

  if (!client) {
    // Development fallback — log OTP instead of sending real SMS
    logger.warn(
      `[Twilio Phone OTP] Credentials not configured. OTP for ${phone}: ${otp}`,
    );
    return;
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: config.twilio.from_number,
      to: phone,
    });

    logger.info(`[Twilio Phone OTP] Sent OTP to ${phone}`, { sid: result.sid });
  } catch (error) {
    logger.error(`[Twilio Phone OTP] Failed to send OTP to ${phone}`, { error });
    throw error;
  }
};
