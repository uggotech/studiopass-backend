import z from "zod";

// ─── Register Device Token ───────────────────────────────────────────────────
// Receives an FCM push token from the client to tie it to the authenticated user.
// This allows sending targeted push notifications.

const registerTokenDto = z.object({
  body: z
    .object({
      token: z.string().trim().min(1, "Token is required"),
      platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
    })
    .strict(),
});

// ─── Remove Device Token ─────────────────────────────────────────────────────
// Unregisters a specific token when a user logs out or the token gets refreshed.

const removeTokenDto = z.object({
  body: z
    .object({
      token: z.string().trim().min(1, "Token is required"),
    })
    .strict(),
});

export const NotificationDto = {
  registerToken: registerTokenDto,
  removeToken: removeTokenDto,
};