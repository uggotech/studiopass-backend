import AfricasTalking from "africastalking";
import config from "config";
import { logger } from "logger/logger";

// ─── Country List ─────────────────────────────────────────────────────────────
// Countries supported via Africa's Talking SMS gateway.
// If user's countryName matches one of these (case-insensitive), AT is used.
// Otherwise, Firebase Phone Auth is used as the fallback.

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

export const sendAtOtp = async (phone: string, otp: string): Promise<void> => {
  const message = `Your StudioPass verification code is: ${otp}. Valid for 30 minutes. Do not share this code.`;

  try {
    const at = getAtClient();
    const sms = at.SMS;

    const result = await sms.send({
      to: [phone],
      message,
      from: "", // uses AT default shortcode; set a sender ID here if registered
    });

    logger.info(`[AT SMS] Sent OTP to ${phone}`, { result });
  } catch (error) {
    logger.error(`[AT SMS] Failed to send OTP to ${phone}`, { error });
    throw error;
  }
};
