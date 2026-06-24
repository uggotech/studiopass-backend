import { z } from "zod";

const sendMessage = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    content: z
      .string()
      .max(1600, "Message content cannot exceed 1600 characters")
      .optional(),
    imageUrl: z.string().optional(),
  }).refine(data => data.content || data.imageUrl, {
    message: "Either content or imageUrl is required",
  }),
});

const sendReply = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    msisdn: z.string().min(1, "Phone number is required"),
    content: z
      .string()
      .min(1, "Message content is required")
      .max(1600, "Message content cannot exceed 1600 characters"),
    templateUsed: z.string().optional(),
  }),
});

const getThread = z.object({
  query: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    msisdn: z.string().min(1, "Phone number is required"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export const MessageDto = {
  sendMessage,
  sendReply,
  getThread,
};
