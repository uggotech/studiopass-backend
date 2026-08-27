/**
 * Country Phone Validation & Normalization Module
 * Single source of truth for country dial codes, expected NSN lengths, and mobile prefix regexes.
 */

export interface CountryPhoneRule {
  iso: string;
  name: string;
  dialCode: string; // e.g. "+880"
  dialDigits: string; // e.g. "880"
  expectedLength: number; // e.g. 10
  regex: RegExp;
  example: string;
  formatDescription: string;
}

export const COUNTRY_PHONE_RULES: Record<string, CountryPhoneRule> = {
  BD: {
    iso: "BD",
    name: "Bangladesh",
    dialCode: "+880",
    dialDigits: "880",
    expectedLength: 10,
    regex: /^1[3-9]\d{8}$/,
    example: "01712345678",
    formatDescription: "10 digits starting with 1 (e.g. 017... or 17...)",
  },
  KE: {
    iso: "KE",
    name: "Kenya",
    dialCode: "+254",
    dialDigits: "254",
    expectedLength: 9,
    regex: /^[17]\d{8}$/,
    example: "0712345678",
    formatDescription: "9 digits starting with 7 or 1 (e.g. 07... or 7...)",
  },
  UG: {
    iso: "UG",
    name: "Uganda",
    dialCode: "+256",
    dialDigits: "256",
    expectedLength: 9,
    regex: /^7\d{8}$/,
    example: "0771234567",
    formatDescription: "9 digits starting with 7 (e.g. 07... or 7...)",
  },
  NG: {
    iso: "NG",
    name: "Nigeria",
    dialCode: "+234",
    dialDigits: "234",
    expectedLength: 10,
    regex: /^[789]\d{9}$/,
    example: "08012345678",
    formatDescription: "10 digits starting with 7, 8, or 9 (e.g. 080... or 80...)",
  },
  TZ: {
    iso: "TZ",
    name: "Tanzania",
    dialCode: "+255",
    dialDigits: "255",
    expectedLength: 9,
    regex: /^[67]\d{8}$/,
    example: "0712345678",
    formatDescription: "9 digits starting with 6 or 7 (e.g. 07... or 7...)",
  },
  GH: {
    iso: "GH",
    name: "Ghana",
    dialCode: "+233",
    dialDigits: "233",
    expectedLength: 9,
    regex: /^[25]\d{8}$/,
    example: "0241234567",
    formatDescription: "9 digits starting with 2 or 5 (e.g. 024... or 24...)",
  },
  IN: {
    iso: "IN",
    name: "India",
    dialCode: "+91",
    dialDigits: "91",
    expectedLength: 10,
    regex: /^[6789]\d{9}$/,
    example: "09812345678",
    formatDescription: "10 digits starting with 6, 7, 8, or 9",
  },
  PK: {
    iso: "PK",
    name: "Pakistan",
    dialCode: "+92",
    dialDigits: "92",
    expectedLength: 10,
    regex: /^3\d{9}$/,
    example: "03001234567",
    formatDescription: "10 digits starting with 3 (e.g. 030... or 30...)",
  },
  ZA: {
    iso: "ZA",
    name: "South Africa",
    dialCode: "+27",
    dialDigits: "27",
    expectedLength: 9,
    regex: /^[678]\d{8}$/,
    example: "0721234567",
    formatDescription: "9 digits starting with 6, 7, or 8",
  },
  EG: {
    iso: "EG",
    name: "Egypt",
    dialCode: "+20",
    dialDigits: "20",
    expectedLength: 10,
    regex: /^1[0125]\d{8}$/,
    example: "01012345678",
    formatDescription: "10 digits starting with 10, 11, 12, or 15",
  },
  US: {
    iso: "US",
    name: "United States",
    dialCode: "+1",
    dialDigits: "1",
    expectedLength: 10,
    regex: /^[2-9]\d{9}$/,
    example: "2025550123",
    formatDescription: "10 digits (area code cannot start with 0 or 1)",
  },
  CA: {
    iso: "CA",
    name: "Canada",
    dialCode: "+1",
    dialDigits: "1",
    expectedLength: 10,
    regex: /^[2-9]\d{9}$/,
    example: "4165550123",
    formatDescription: "10 digits (area code cannot start with 0 or 1)",
  },
  GB: {
    iso: "GB",
    name: "United Kingdom",
    dialCode: "+44",
    dialDigits: "44",
    expectedLength: 10,
    regex: /^7\d{9}$/,
    example: "07911123456",
    formatDescription: "10 digits starting with 7",
  },
};

/**
 * Resolve country phone rule by ISO code first (preferred), with dial code fallback.
 */
export function getRuleByIsoOrDialCode(
  iso?: string,
  dialCode?: string,
): CountryPhoneRule | null {
  if (iso) {
    const upperIso = iso.trim().toUpperCase();
    if (COUNTRY_PHONE_RULES[upperIso]) {
      return COUNTRY_PHONE_RULES[upperIso];
    }
  }
  if (dialCode) {
    const cleanDial = dialCode.replace(/\D/g, "");
    if (cleanDial) {
      const found = Object.values(COUNTRY_PHONE_RULES).find(
        (r) => r.dialDigits === cleanDial,
      );
      if (found) return found;
    }
  }
  return null;
}

export interface PhoneValidationResult {
  isValid: boolean;
  cleanNational?: string; // e.g. "1712345678"
  fullPhone?: string; // e.g. "+8801712345678"
  countryIso?: string;
  dialCode?: string;
  error?: string;
}

/**
 * Universal 4-step Phone Number Normalizer and Validator
 */
export function validatePhoneNumber(
  rawInput: string,
  options: { iso?: string; dialCode?: string; countryName?: string } = {},
): PhoneValidationResult {
  if (!rawInput || typeof rawInput !== "string") {
    return { isValid: false, error: "Phone number is required" };
  }

  // Step 1: Sanitize to digits only
  let cleanDigits = rawInput.replace(/\D/g, "");
  if (!cleanDigits) {
    return { isValid: false, error: "Phone number cannot be empty" };
  }

  const rule = getRuleByIsoOrDialCode(options.iso, options.dialCode);
  const dialDigits = rule
    ? rule.dialDigits
    : options.dialCode
      ? options.dialCode.replace(/\D/g, "")
      : "";

  // Step 2: Strip accidental pasted dial code if present
  if (dialDigits && cleanDigits.startsWith(dialDigits)) {
    if (rule) {
      if (cleanDigits.length > rule.expectedLength) {
        cleanDigits = cleanDigits.substring(dialDigits.length);
      }
    } else {
      // Fallback: only strip dial code if remaining length is within valid E.164 range (7..15)
      const remainingLength = cleanDigits.length - dialDigits.length;
      if (remainingLength >= 7 && remainingLength <= 15) {
        cleanDigits = cleanDigits.substring(dialDigits.length);
      }
    }
  }

  // Step 3: Strip leading domestic trunk "0"
  if (cleanDigits.startsWith("0")) {
    cleanDigits = cleanDigits.substring(1);
  }

  // Step 4: Validate and format E.164
  if (rule) {
    if (cleanDigits.length !== rule.expectedLength) {
      return {
        isValid: false,
        error: `Invalid phone number for ${rule.name}. Expected ${rule.formatDescription}.`,
      };
    }
    if (!rule.regex.test(cleanDigits)) {
      return {
        isValid: false,
        error: `Invalid mobile prefix for ${rule.name}. Must be ${rule.formatDescription}.`,
      };
    }
    const fullPhone = `+${rule.dialDigits}${cleanDigits}`;
    return {
      isValid: true,
      cleanNational: cleanDigits,
      fullPhone,
      countryIso: rule.iso,
      dialCode: rule.dialCode,
    };
  }

  // Fallback (unlisted country) validation: ITU-T E.164 7-15 digits
  if (cleanDigits.length < 7 || cleanDigits.length > 15) {
    return {
      isValid: false,
      error: "Phone number must be between 7 and 15 digits.",
    };
  }

  const fullPhone = dialDigits
    ? `+${dialDigits}${cleanDigits}`
    : `+${cleanDigits}`;

  return {
    isValid: true,
    cleanNational: cleanDigits,
    fullPhone,
    dialCode: dialDigits ? `+${dialDigits}` : undefined,
  };
}

/**
 * Validate optional phone input for dashboard forms.
 * Returns isValid: true if empty or null; otherwise validates against country rules.
 */
export function validateOptionalPhone(
  rawInput?: string | null,
  options: { iso?: string; dialCode?: string } = {},
): { isValid: boolean; fullPhone?: string; cleanNational?: string; error?: string } {
  if (!rawInput || rawInput.trim() === "") {
    return { isValid: true, fullPhone: undefined, cleanNational: undefined };
  }
  return validatePhoneNumber(rawInput, options);
}
