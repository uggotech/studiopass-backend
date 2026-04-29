import z from "zod";

// ─── Follow Broadcast ────────────────────────────────────────────────────────
// DTO for users to subscribe/follow a specific broadcast/channel.

const followBroadcastDto = z.object({
  body: z
    .object({
      notificationsEnabled: z.boolean().optional(),
    })
    .strict(),
});

// ─── Update Follow Preferences ───────────────────────────────────────────────
// DTO to toggle notifications on/off for a currently followed broadcast.

const updateFollowPreferencesDto = z.object({
  body: z
    .object({
      notificationsEnabled: z.boolean(),
    })
    .strict(),
});

export const FollowDto = {
  followBroadcast: followBroadcastDto,
  updateFollowPreferences: updateFollowPreferencesDto,
};