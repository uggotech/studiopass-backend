import { z } from "zod";
import { passwordSchema } from "../../shared/validators/password.validator";
import { validatePhoneNumber } from "../../shared/validators/phone.validator";

const initiate = z.object({
  body: z
    .object({
      phone: z.string().min(1, "Phone is required"),
      countryCode: z.string().min(1, "Country code is required"),
      countryName: z.string().min(1, "Country name is required"),
    })
    .refine(
      (data) => {
        const result = validatePhoneNumber(data.phone, {
          dialCode: data.countryCode,
          countryName: data.countryName,
        });
        return result.isValid;
      },
      {
        message: "Invalid phone number for the selected country",
        path: ["phone"],
      },
    ),
});

const verifyOtp = z.object({
  body: z
    .object({
      phone: z.string().min(1, "Phone is required"),
      countryCode: z.string().min(1, "Country code is required"),
      otp: z.string().length(4, "OTP must be 4 digits"),
      countryName: z.string().optional(),
    })
    .refine(
      (data) => {
        const result = validatePhoneNumber(data.phone, {
          dialCode: data.countryCode,
          countryName: data.countryName,
        });
        return result.isValid;
      },
      {
        message: "Invalid phone number for the selected country",
        path: ["phone"],
      },
    ),
});

const login = z.object({
  body: z.object({
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
  }),
});

const refresh = z.object({
  body: z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
  }),
});

const changePassword = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
  }),
});

const verify2FALogin = z.object({
  body: z.object({
    tempToken: z.string().min(1, "Temporary token is required"),
    code: z.string().min(1, "Verification or recovery code is required"),
  }),
});

const setup2FAEnable = z.object({
  body: z.object({
    tempToken: z.string().optional(),
    code: z.string().min(1, "6-digit verification code is required"),
  }),
});

const skip2FASetup = z.object({
  body: z.object({
    tempToken: z.string().min(1, "Temporary token is required"),
  }),
});

const disable2FA = z.object({
  body: z.object({
    password: z.string().min(1, "Current password is required"),
    code: z.string().min(1, "Current 6-digit authenticator code is required"),
  }),
});

export const AuthDto = {
  initiate,
  verifyOtp,
  login,
  refresh,
  changePassword,
  verify2FALogin,
  setup2FAEnable,
  skip2FASetup,
  disable2FA,
};
