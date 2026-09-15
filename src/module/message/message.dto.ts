import { z } from "zod";

const sendMessage = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    content: z
      .string()
      .trim()
      .max(1600, "Message content cannot exceed 1600 characters")
      .optional(),
    imageUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    audioUrl: z.string().optional(),
    stickerUrl: z.string().optional(),
    audioDuration: z.number().optional(),
    waveform: z.array(z.number().min(0).max(1)).max(128).optional(),
    mediaType: z.enum(["text", "image", "video", "audio", "sticker"]).optional(),
  }).refine(data => (data.content && data.content.length > 0) || data.imageUrl || data.audioUrl || data.videoUrl || data.stickerUrl, {
    message: "Either content, imageUrl, audioUrl, videoUrl, or stickerUrl is required",
  }),
});

const sendReply = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required").optional(),
    msisdn: z.string().min(1, "Phone number is required"),
    content: z
      .string()
      .max(1600, "Message content cannot exceed 1600 characters")
      .optional(),
    imageUrl: z.string().optional(),
    audioUrl: z.string().optional(),
    audioDuration: z.number().optional(),
    waveform: z.array(z.number().min(0).max(1)).max(128).optional(),
    mediaType: z.enum(["text", "image", "video", "audio"]).optional(),
    templateUsed: z.string().optional(),
  }).refine(data => (data.content && data.content.trim().length > 0) || data.imageUrl || data.audioUrl, {
    message: "Either content, imageUrl, or audioUrl is required to reply",
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
    showId: z.string().optional(),
    todayOnly: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
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
    search: z.string().optional(),
    type: z.enum(["all", "text", "image", "audio"]).optional(),
    timeRange: z.enum(["all", "today", "7days", "30days"]).optional(),
  }),
});

const deleteMessage = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
});

const editMessage = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
  body: z.object({
    content: z
      .string()
      .trim()
      .min(1, "Content is required")
      .max(1600, "Message content cannot exceed 1600 characters"),
  }),
});

const deleteForMe = z.object({
  params: z.object({
    id: z.string().min(1, "Message ID is required"),
  }),
});

const deleteForEveryone = z.object({
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

const uploadAudio = z.object({
  body: z.object({
    audio: z.string().min(1, "Audio URL is required"),
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
  editMessage,
  deleteForMe,
  deleteForEveryone,
  markAsRead,
  getPendingMessages,
  uploadImage,
  uploadAudio,
};
