import { CARRIER_REGISTRY, CountryCarriers } from "./carrier.registry";

export class CarrierService {
  /**
   * Cleans a raw phone string down to digits only.
   * Strips leading '+', spaces, hyphens, and parentheses.
   */
  public static sanitizeDigits(rawPhone: string): string {
    if (!rawPhone) return "";
    return rawPhone.replace(/\D/g, "");
  }

  /**
   * Resolves the country carrier rules either by ISO code or by matching the leading dial digits.
   */
  public static resolveCountry(
    digits: string,
    countryHint?: string,
  ): CountryCarriers | null {
    if (countryHint) {
      const upper = countryHint.toUpperCase().trim();
      if (CARRIER_REGISTRY[upper]) {
        return CARRIER_REGISTRY[upper];
      }
      // Also match if countryHint is full name or dialCode
      const byDial = Object.values(CARRIER_REGISTRY).find(
        (c) => c.dialCode === countryHint || c.dialDigits === countryHint,
      );
      if (byDial) return byDial;
    }

    // Auto-detect by dial digits prefix from the phone number
    for (const country of Object.values(CARRIER_REGISTRY)) {
      if (digits.startsWith(country.dialDigits)) {
        return country;
      }
    }

    // Default fallback to Uganda if not matched and looks like UG length
    return null;
  }

  /**
   * Extracts the National Significant Number (NSN) by stripping country dial code and leading zero.
   */
  public static extractNsn(digits: string, dialDigits: string): string {
    let nsn = digits;
    if (nsn.startsWith(dialDigits)) {
      nsn = nsn.slice(dialDigits.length);
    }
    // Remove national trunk prefix '0' if present
    if (nsn.startsWith("0")) {
      nsn = nsn.slice(1);
    }
    return nsn;
  }

  /**
   * Detects the mobile network operator (MNO) for a given phone number.
   *
   * @param phone Raw phone number (e.g., "+256701234567", "0701234567", "256771234567")
   * @param countryHint Optional ISO code ("UG", "KE", "NG") or dial code
   * @returns Carrier name (e.g., "Airtel", "MTN", "Safaricom") or null if unrecognized
   */
  public static detectOperator(
    phone?: string | null,
    countryHint?: string | null,
  ): string | null {
    if (!phone) return null;

    const digits = this.sanitizeDigits(phone);
    if (!digits) return null;

    // Resolve country rules
    const country = this.resolveCountry(digits, countryHint || undefined) || CARRIER_REGISTRY.UG;
    if (!country) return null;

    // Extract NSN (without dialDigits or national trunk '0')
    const nsn = this.extractNsn(digits, country.dialDigits);

    // Match against carrier regexes
    for (const carrier of country.carriers) {
      if (carrier.prefixes.test(nsn)) {
        return carrier.name;
      }
    }

    // If initial country hint didn't match, check other registered countries as a fallback
    for (const otherCountry of Object.values(CARRIER_REGISTRY)) {
      if (otherCountry.countryIso === country.countryIso) continue;
      if (digits.startsWith(otherCountry.dialDigits)) {
        const otherNsn = this.extractNsn(digits, otherCountry.dialDigits);
        for (const carrier of otherCountry.carriers) {
          if (carrier.prefixes.test(otherNsn)) {
            return carrier.name;
          }
        }
      }
    }

    return null;
  }

  /**
   * Normalizes a Uganda phone number into standardized E.164 (+256...) and national formats,
   * while detecting the operator.
   */
  public static normalizeUgandaPhone(phone: string): {
    isValid: boolean;
    e164: string;
    national: string;
    operator: string | null;
  } {
    const digits = this.sanitizeDigits(phone);
    const nsn = this.extractNsn(digits, "256");

    // Uganda NSN is exactly 9 digits starting with 7, 2, or 3
    const isValid = /^[237]\d{8}$/.test(nsn);
    if (!isValid) {
      return {
        isValid: false,
        e164: phone,
        national: phone,
        operator: null,
      };
    }

    const operator = this.detectOperator(phone, "UG");

    return {
      isValid: true,
      e164: `+256${nsn}`,
      national: `0${nsn}`,
      operator,
    };
  }
}
