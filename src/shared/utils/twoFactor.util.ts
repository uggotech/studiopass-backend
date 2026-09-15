import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

export interface Generated2FASetup {
  secret: string;
  otpAuthUrl: string;
  qrCodeDataUrl: string;
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

  return {
    secret,
    otpAuthUrl,
    qrCodeDataUrl,
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
