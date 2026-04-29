import z from "zod";

// ─── Core Schemas ────────────────────────────────────────────────────────────
// Common reusable validations for broadcast objects and embedded schema rules.

const socialLinksSchema = z
  .object({
    facebook: z.string().trim().min(1).optional(),
    instagram: z.string().trim().min(1).optional(),
  })
  .strict()
  .optional();

const broadcastBodySchema = z
  .object({
    name: z.string().trim().min(1, "Broadcast name is required"),
    type: z.enum(["tv", "radio", "channel"]),
    description: z.string().trim().optional(),
    country: z.string().trim().min(1, "Country is required"),
    mottoLine: z.string().trim().optional(),
    logo: z.string().trim().optional(),
    coverImage: z.string().trim().optional(),
    streamUrl: z.string().trim().min(1, "Stream URL is required"),
    category: z.array(z.string().trim().min(1)).optional(),
    website: z.string().trim().optional(),
    socialLinks: socialLinksSchema,
    isLive: z.boolean().optional(),
    liveTitle: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    isVerified: z.boolean().optional(),
  })
  .strict();

// ─── Create Broadcast ────────────────────────────────────────────────────────
// DTO for administrators to create a new broadcast channel/station.
const createBroadcastDto = z.object({
  body: broadcastBodySchema,
});

// ─── Update Broadcast ────────────────────────────────────────────────────────
// DTO for administrators to update an existing broadcast (supports partial updates).
const updateBroadcastDto = z.object({
  body: broadcastBodySchema.partial().strict(),
});

// ─── Broadcast Notification ──────────────────────────────────────────────────
// DTO for triggering push notification broadcasts directly to all followers of a channel.
const sendBroadcastNotificationDto = z.object({
  body: z
    .object({
      title: z.string().trim().min(1, "Notification title is required"),
      body: z.string().trim().min(1, "Notification body is required"),
      data: z.record(z.string(), z.any()).optional(),
    })
    .strict(),
});

// ─── Upload Broadcast Images ──────────────────────────────────────────────────
// DTO for uploading logo and cover image (supports local file uploads or URL strings).
const uploadBroadcastImagesDto = z.object({
  body: z
    .object({
      logo: z.string().trim().min(1).optional(),
      coverImage: z.string().trim().min(1).optional(),
    })
    .strict()
    .refine(
      (data) => data.logo || data.coverImage,
      "At least one image (logo or coverImage) must be provided",
    ),
});

export const BroadcastDto = {
  createBroadcast: createBroadcastDto,
  updateBroadcast: updateBroadcastDto,
  sendBroadcastNotification: sendBroadcastNotificationDto,
  uploadBroadcastImages: uploadBroadcastImagesDto,
};