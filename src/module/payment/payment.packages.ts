import config from "../../config";
import { logger } from "../../logger/logger";

export interface CreditPackage {
  id: string;
  amountUgx: number;
  credits: number;
  label: string;
}

/**
 * PLACEHOLDER credit values, derived from the Uganda credit price (500 UGX per credit).
 * Replace via the PAYMENT_PACKAGES env var once the client confirms the packages (questionnaire PK-1).
 */
const DEFAULT_PACKAGES: CreditPackage[] = [
  { id: "pkg_500", amountUgx: 500, credits: 1, label: "Starter" },
  { id: "pkg_1000", amountUgx: 1000, credits: 2, label: "Basic" },
  { id: "pkg_2000", amountUgx: 2000, credits: 4, label: "Standard" },
  { id: "pkg_5000", amountUgx: 5000, credits: 10, label: "Premium" },
];

const isValidPackage = (p: any): p is CreditPackage =>
  p &&
  typeof p.id === "string" &&
  p.id.length > 0 &&
  Number.isInteger(p.amountUgx) &&
  p.amountUgx > 0 &&
  Number.isInteger(p.credits) &&
  p.credits > 0 &&
  typeof p.label === "string";

let cached: CreditPackage[] | null = null;

export function getCreditPackages(): CreditPackage[] {
  if (cached) return cached;

  const raw = config.payment_packages;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidPackage)) {
        cached = parsed;
        return cached;
      }
      logger.error("[Payment Packages] PAYMENT_PACKAGES is not a valid package array. Falling back to defaults.");
    } catch {
      logger.error("[Payment Packages] PAYMENT_PACKAGES is not valid JSON. Falling back to defaults.");
    }
  }

  cached = DEFAULT_PACKAGES;
  return cached;
}

export function findCreditPackage(packageId: string): CreditPackage | undefined {
  return getCreditPackages().find((p) => p.id === packageId);
}
