import { z } from "zod";

const updateProfile = z.object({
  fullName: z.string().min(1).max(100).optional(),
  countryId: z.string().optional(),
});

const updatePreferences = z.object({
  theme: z.enum(["default", "dark", "light"]).optional(),
  language: z.enum(["english", "swahili"]).optional(),
});

const updateFcmToken = z.object({
  fcmToken: z.string().min(1, "FCM token is required"),
});

const completeProfile = z.object({
  fullName: z.string().min(1, "Name is required").max(100),
});

export const UserDto = {
  updateProfile,
  updatePreferences,
  updateFcmToken,
  completeProfile,
};
