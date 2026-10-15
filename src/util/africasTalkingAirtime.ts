import AfricasTalking from "africastalking";
import config from "../config";
import { logger } from "../logger/logger";
import { normalizeUgandaPhone } from "../shared/telecom/ugandaPhone.util";

let atClient: any = null;

const getAtClient = () => {
  if (!atClient) {
    atClient = AfricasTalking({
      apiKey: config.africas_talking.api_key,
      username: config.africas_talking.username,
    });
  }
  return atClient;
};

export interface AirtimeSendResult {
  success: boolean;
  requestId?: string;
  status?: string;
  discount?: string;
  rawResponse?: any;
  error?: string;
}

/**
 * Dispatches live airtime top-up via Africa's Talking Airtime API.
 * Automatically enforces E.164 phone formatting (+256...) and idempotency.
 */
export async function sendAirtime(params: {
  phoneNumber: string;
  amount: number;
  currencyCode?: string;
  idempotencyKey?: string;
}): Promise<AirtimeSendResult> {
  const { phoneNumber, amount, currencyCode = "UGX", idempotencyKey } = params;

  // Validate and normalize phone number
  const phoneInfo = normalizeUgandaPhone(phoneNumber);
  const normalizedPhone = phoneInfo.isValid ? phoneInfo.e164 : phoneNumber.trim();

  if (!normalizedPhone.startsWith("+")) {
    return {
      success: false,
      error: `Invalid phone format for Africa's Talking: ${phoneNumber}. Must be E.164 (e.g. +256...)`,
    };
  }

  if (!amount || amount <= 0) {
    return {
      success: false,
      error: `Invalid airtime amount: ${amount}. Must be greater than 0.`,
    };
  }

  try {
    const at = getAtClient();
    const airtime = at.AIRTIME;

    logger.info(`[AT Airtime] Sending UGX ${amount} airtime to ${normalizedPhone} (idempotencyKey: ${idempotencyKey})`);

    const sendOptions: any = {
      recipients: [
        {
          phoneNumber: normalizedPhone,
          currencyCode,
          amount,
        },
      ],
    };

    if (idempotencyKey) {
      sendOptions.idempotencyKey = idempotencyKey;
    }

    const response = await airtime.send(sendOptions);
    logger.info("[AT Airtime] Raw response:", response);

    const firstRecipient = response?.responses?.[0];
    const status = firstRecipient?.status || "Unknown";
    const requestId = firstRecipient?.requestId;
    const errorMessage = firstRecipient?.errorMessage;

    if (errorMessage && errorMessage !== "None") {
      logger.error(`[AT Airtime] Recipient error: ${errorMessage}`);
      return {
        success: false,
        status,
        requestId,
        error: errorMessage,
        rawResponse: response,
      };
    }

    return {
      success: status === "Sent" || status === "Queued",
      status,
      requestId,
      discount: response?.totalDiscount,
      rawResponse: response,
    };
  } catch (error: any) {
    logger.error(`[AT Airtime] Failed to send airtime to ${normalizedPhone}:`, error);
    return {
      success: false,
      error: error.message || "Failed to dispatch airtime via Africa's Talking",
    };
  }
}
