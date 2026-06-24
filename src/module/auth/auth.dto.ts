import { z } from "zod";

const initiate = z.object({
  body: z.object({
    phone: z.string().min(1, "Phone is required"),
    countryCode: z.string().min(1, "Country code is required"),
    countryName: z.string().min(1, "Country name is required"),
  }),
});

const verifyOtp = z.object({
  body: z.object({
    phone: z.string().min(1, "Phone is required"),
    countryCode: z.string().min(1, "Country code is required"),
    otp: z.string().length(4, "OTP must be 4 digits"),
    countryName: z.string().optional(),
  }),
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

export const AuthDto = { initiate, verifyOtp, login, refresh };
