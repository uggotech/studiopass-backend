import { z } from "zod";

export const SupportDto = {
  createConversation: z.object({
    body: z.object({
      message: z.string().min(1, "Initial message is required"),
    }),
  }),

  sendMessage: z.object({
    body: z.object({
      message: z.string().optional(),
      attachments: z.array(z.string()).optional(),
      image: z.string().optional(),
    }),
  }),

  search: z.object({
    query: z.object({
      query: z.string().optional(),
      page: z.string().optional(),
      limit: z.string().optional(),
    }),
  }),
};
