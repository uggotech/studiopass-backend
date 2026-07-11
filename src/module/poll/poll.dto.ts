import { z } from "zod";

const createPoll = z.object({
  body: z.object({
    stationId: z.string().optional(),
    question: z.string().min(1, "Question is required").max(500),
    options: z.array(z.string().min(1).max(100)).min(2, "At least 2 options required").max(10),
    showId: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
  }),
});

const getStationPolls = z.object({
  query: z.object({
    stationId: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(["draft", "active", "completed"]).optional(),
  }),
});

const getAllPolls = z.object({
  query: z.object({
    station: z.string().optional(),
    status: z.enum(["draft", "active", "completed"]).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

const getPollById = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
});

const votePoll = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
  body: z.object({
    optionIndex: z.number().int().min(0, "Option index must be non-negative"),
  }),
});

const updatePoll = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
  body: z.object({
    question: z.string().min(1).max(500).optional(),
    status: z.enum(["draft", "active", "completed"]).optional(),
    expiresAt: z.string().datetime().optional(),
  }),
});

const deletePoll = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
});

export const PollDto = {
  createPoll,
  getStationPolls,
  getAllPolls,
  getPollById,
  votePoll,
  updatePoll,
  deletePoll,
};
