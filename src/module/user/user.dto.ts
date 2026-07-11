import { z } from "zod";

const updateProfile = z.object({
  body: z.object({
    fullName: z.string().min(1).max(100).optional(),
    countryId: z.string().optional(),
  }),
});

const updatePreferences = z.object({
  body: z.object({
    theme: z.enum(["default", "dark", "light"]).optional(),
    language: z.enum(["english", "swahili"]).optional(),
  }),
});

const updateFcmToken = z.object({
  body: z.object({
    fcmToken: z.string().min(1, "FCM token is required"),
  }),
});

const completeProfile = z.object({
  body: z.object({
    fullName: z.string().min(1, "Name is required").max(100),
  }),
});

const createMediaStation = z.object({
  body: z.object({
    fullName: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(1, "Phone is required").max(20).optional(),
    stationId: z.string().min(1, "Station ID is required"),
    username: z.string().min(3, "Username must be at least 3 characters").max(50),
    password: z.string().min(6, "Password must be at least 6 characters").max(100),
  }),
});

const createPresenter = z.object({
  body: z.object({
    fullName: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(1, "Phone is required").max(20).optional(),
    stationId: z.string().min(1, "Station ID is required"),
    showId: z.string().optional(),
    username: z.string().min(3, "Username must be at least 3 characters").max(50),
    password: z.string().min(6, "Password must be at least 6 characters").max(100),
  }),
});

export const UserDto = {
  updateProfile,
  updatePreferences,
  updateFcmToken,
  completeProfile,
  createMediaStation,
  createPresenter,
};
