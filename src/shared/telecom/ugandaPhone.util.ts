/**
 * Uganda Phone Number Normalization & Carrier Routing Utility
 *
 * Provides single source of truth for:
 * 1. Normalizing raw user phone numbers (with/without '+' or leading '0', dashes, spaces).
 * 2. Generating exact string formats required by providers:
 *    - E.164: "+256771819679" (Africa's Talking Airtime & SMS)
 *    - PayLeo (True African): "256771819679" (12 digits, no '+')
 *    - Airtel OpenAPI: "771819679" (strictly 9 digits starting with '7')
 *    - National: "0771819679" (local display)
 * 3. Detecting Mobile Network Operator (MNO): MTN, AIRTEL, UTL, LYCAMOBILE.
 */

export type UgandaCarrier = "MTN" | "AIRTEL" | "UTL" | "LYCAMOBILE" | "UNKNOWN";

export interface NormalizedUgandaPhone {
  isValid: boolean;
  rawInput: string;
  e164: string;           // "+2567XXXXXXXX"
  payleoMsisdn: string;   // "2567XXXXXXXX"
  airtelMsisdn: string;   // "7XXXXXXXX"
  national: string;       // "07XXXXXXXX"
  carrier: UgandaCarrier;
  error?: string;
}

const MTN_PREFIXES = /^(?:76|77|78|79|31|39)\d{7}$/;
const AIRTEL_PREFIXES = /^(?:70|73|74|75|20)\d{7}$/;
const UTL_PREFIXES = /^(?:71|41)\d{7}$/;
const LYCAMOBILE_PREFIXES = /^(?:72)\d{7}$/;

/**
 * Normalizes and analyzes a Uganda phone number.
 */
export function normalizeUgandaPhone(input: string): NormalizedUgandaPhone {
  const rawInput = String(input || "").trim();
  const digitsOnly = rawInput.replace(/\D+/g, "");

  let nationalDigits = ""; // 9 digits without country code or leading 0

  if (digitsOnly.startsWith("256") && digitsOnly.length === 12) {
    nationalDigits = digitsOnly.slice(3);
  } else if (digitsOnly.startsWith("0") && digitsOnly.length === 10) {
    nationalDigits = digitsOnly.slice(1);
  } else if (digitsOnly.length === 9) {
    nationalDigits = digitsOnly;
  } else {
    return {
      isValid: false,
      rawInput,
      e164: "",
      payleoMsisdn: "",
      airtelMsisdn: "",
      national: "",
      carrier: "UNKNOWN",
      error: "Invalid Uganda phone number length. Expected 9-12 digits.",
    };
  }

  // Detect Carrier
  let carrier: UgandaCarrier = "UNKNOWN";
  if (MTN_PREFIXES.test(nationalDigits)) {
    carrier = "MTN";
  } else if (AIRTEL_PREFIXES.test(nationalDigits)) {
    carrier = "AIRTEL";
  } else if (UTL_PREFIXES.test(nationalDigits)) {
    carrier = "UTL";
  } else if (LYCAMOBILE_PREFIXES.test(nationalDigits)) {
    carrier = "LYCAMOBILE";
  }

  return {
    isValid: true,
    rawInput,
    e164: `+256${nationalDigits}`,
    payleoMsisdn: `256${nationalDigits}`,
    airtelMsisdn: nationalDigits,
    national: `0${nationalDigits}`,
    carrier,
  };
}
