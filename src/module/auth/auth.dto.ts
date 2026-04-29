import z from "zod";

// ─── Initiate Auth ───────────────────────────────────────────────────────────
// One entry point for sign-up and login. The service decides whether to create
// an account or send a login OTP based on the stored auth state.

const initiateAuthDto = z.object({
  body: z
    .object({
      phone: z.string().min(4, "Phone number is required").trim(),
      countryCode: z
        .string()
        .regex(/^\+[1-9]\d{0,3}$/, "Country code must be in format +1, +234 etc.")
        .trim(),
      countryName: z.string().min(1, "Country name is required").trim(),
    })
    .strict(),
});

// ─── Verify OTP ──────────────────────────────────────────────────────────────
// Verifies either the account-verification OTP or the login OTP.

const verifyOtpDto = z.object({
  body: z
    .object({
      phone: z.string().min(4, "Phone number is required").trim(),
      countryCode: z
        .string()
        .regex(/^\+[1-9]\d{0,3}$/, "Country code must be in format +1, +234 etc.")
        .trim(),
      otp: z.string().length(4, "OTP must be exactly 4 digits"),
    })
    .strict(),
});

// ─── Resend OTP ───────────────────────────────────────────────────────────────

const resendOtpDto = z.object({
  body: z
    .object({
      phone: z.string().min(4, "Phone number is required").trim(),
      countryCode: z
        .string()
        .regex(/^\+[1-9]\d{0,3}$/, "Country code must be in format +1, +234 etc.")
        .trim(),
    })
    .strict(),
});

// ─── Refresh Access Token ─────────────────────────────────────────────────────

const refreshAccessTokenDto = z.object({
  body: z
    .object({
      refreshToken: z.string().min(1, "Refresh token is required"),
    })
    .strict(),
});

export const AuthDto = {
  initiateAuth: initiateAuthDto,
  verifyOtp: verifyOtpDto,
  resendOtp: resendOtpDto,
  refreshAccessToken: refreshAccessTokenDto,
};
