import { z } from "zod";

const createKey = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
    name: z.string().min(1, "Key name is required").max(100),
    type: z.enum(["sandbox", "production"]),
  }),
});

const getKeys = z.object({
  query: z.object({
    stationId: z.string().optional(),
  }),
});

const getMessages = z.object({
  query: z.object({
    apiKey: z.string().optional(),
    limit: z.coerce.number().int().positive().max(100).default(20),
    show: z.string().optional(),
    before: z.string().optional(),
  }),
});

const revealKey = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    password: z.string().min(1, "Password is required"),
  }),
});

export const StationApiKeyDto = {
  createKey,
  getKeys,
  getMessages,
  revealKey,
};
