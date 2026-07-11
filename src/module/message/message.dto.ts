import { z } from "zod";

const sendMessage = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    content: z
      .string()
      .trim()
      .min(1, "Message content cannot be empty")
      .max(1600, "Message content cannot exceed 1600 characters")
      .optional(),
    imageUrl: z.string().optional(),
  }).refine(data => data.content || data.imageUrl, {
    message: "Either content or imageUrl is required",
  }),
});

const sendReply = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required").optional(),
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
    stationId: z.string().min(1, "Station ID is required").optional(),
    msisdn: z.string().min(1, "Phone number is required"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

const getThreads = z.object({
  query: z.object({
    stationId: z.string().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

const approveMessage = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
});

const rejectMessage = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
  body: z.object({
    rejectionReason: z.string().min(1, "Rejection reason is required").max(500),
  }),
});

const sendToOutput = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
});

const getPendingMessages = z.object({
  query: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

const deleteMessage = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
});

const markAsRead = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
});

const uploadImage = z.object({
  body: z.object({
    image: z.string().min(1, "Image URL is required"),
  }),
});

export const MessageDto = {
  sendMessage,
  sendReply,
  getThread,
  getThreads,
  approveMessage,
  rejectMessage,
  sendToOutput,
  deleteMessage,
  markAsRead,
  getPendingMessages,
  uploadImage,
};
