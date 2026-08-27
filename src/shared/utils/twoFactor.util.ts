import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";
import bcrypt from "bcryptjs";

export interface Generated2FASetup {
  secret: string;
  otpAuthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}

/**
 * Generates a base32 TOTP secret and a QR code data URL for a user
 */
export async function generate2FASetup(
  accountIdentifier: string,
  issuer: string = "StudioPass",
): Promise<Generated2FASetup> {
  const secret = generateSecret();
  const otpAuthUrl = generateURI({
    issuer,
    label: accountIdentifier,
    secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 240,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  const recoveryCodes = generateRecoveryCodes(8);

  return {
    secret,
    otpAuthUrl,
    qrCodeDataUrl,
    recoveryCodes,
  };
}

/**
 * Validates a 6-digit TOTP code against a base32 secret with 30s drift tolerance
 */
export function verify2FACode(code: string, secret: string): boolean {
  if (!code || !secret) return false;
  try {
    const result = verifySync({
      token: code.trim(),
      secret: secret.trim(),
      epochTolerance: 30,
    });
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Generates N cryptographically secure, readable recovery codes (format: XXXX-XXXX)
 */
export function generateRecoveryCodes(count: number = 8): string[] {
  const charset = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // exclude ambiguous chars 0, 1, I, O
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    const bytes = crypto.randomBytes(8);
    let code = "";
    for (let j = 0; j < 8; j++) {
      const byteVal = bytes[j] ?? 0;
      code += charset[byteVal % charset.length];
      if (j === 3) code += "-";
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Hashes an array of recovery codes for secure storage in MongoDB
 */
export async function hashRecoveryCodes(plainCodes: string[]): Promise<string[]> {
  return Promise.all(plainCodes.map((code) => bcrypt.hash(code.toUpperCase().trim(), 10)));
}

/**
 * Verifies if a submitted recovery code matches one of the stored hashes.
 * If valid, returns the matching index so it can be burned.
 */
export async function verifyAndConsumeRecoveryCode(
  submittedCode: string,
  hashedCodes: string[],
): Promise<{ isValid: boolean; matchedIndex: number }> {
  const normalized = submittedCode.toUpperCase().trim();

  for (let i = 0; i < hashedCodes.length; i++) {
    const hash = hashedCodes[i];
    if (hash) {
      const matches = await bcrypt.compare(normalized, hash);
      if (matches) {
        return { isValid: true, matchedIndex: i };
      }
    }
  }

  return { isValid: false, matchedIndex: -1 };
}
