import { z } from "zod";

const createStatus = z.object({
  body: z.object({
    stationId: z.string().optional(),
    content: z.string().min(1, "Content is required").max(2000),
    media: z.string().optional(),
    mediaType: z.enum(["image", "video"]).optional(),
    thumbnail: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
  }),
});

const getStationStatuses = z.object({
  params: z.object({
    stationId: z.string().min(1, "Station ID is required"),
  }),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

const getStatusById = z.object({
  params: z.object({
    id: z.string().min(1, "Status ID is required"),
  }),
});

const deleteStatus = z.object({
  params: z.object({
    id: z.string().min(1, "Status ID is required"),
  }),
});

const generateWeeklyTopFans = z.object({
  body: z.object({
    stationId: z.string().min(1, "Station ID is required"),
  }),
});

export const StatusDto = {
  createStatus,
  getStationStatuses,
  getStatusById,
  deleteStatus,
  generateWeeklyTopFans,
};
