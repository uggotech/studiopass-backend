import { z } from "zod";

const nomineeSchema = z.object({
  name: z.string().min(1, "Nominee name is required").max(100),
  photo: z.string().optional(),
  description: z.string().max(500).optional(),
});

const categorySchema = z.object({
  name: z.string().min(1, "Category name is required").max(100),
  nominees: z
    .array(nomineeSchema)
    .min(2, "At least 2 nominees required per category"),
});

const createPoll = z.object({
  body: z
    .object({
      station: z.string().optional(),
      title: z.string().min(1, "Title is required").max(200),
      description: z.string().max(2000).optional(),
      categories: z
        .array(categorySchema)
        .min(1, "At least 1 category required"),
      billingMode: z.enum(["credits", "free"]).optional(),
      creditCost: z.number().min(0).optional(),
      startDate: z.string().min(1, "Start date is required"),
      endDate: z.string().min(1, "End date is required"),
    })
    .superRefine((data, ctx) => {
      const start = new Date(data.startDate).getTime();
      const end = new Date(data.endDate).getTime();
      const nowBuffer = Date.now() - 15 * 60 * 1000; // 15 mins grace period for form completion / latency

      if (isNaN(start)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid start date",
          path: ["startDate"],
        });
      } else if (start < nowBuffer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Start date cannot be in the past",
          path: ["startDate"],
        });
      }

      if (isNaN(end)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid end date",
          path: ["endDate"],
        });
      } else if (!isNaN(start) && end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "End date must be after start date",
          path: ["endDate"],
        });
      }
    }),
});

const getStationPolls = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    status: z.enum(["draft", "scheduled", "active", "completed"]).optional(),
  }),
});

const getAllPolls = z.object({
  query: z.object({
    station: z.string().optional(),
    status: z.enum(["draft", "scheduled", "active", "completed"]).optional(),
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
    categoryIndex: z.number().int().min(0, "Category index must be non-negative"),
    nomineeIndex: z.number().int().min(0, "Nominee index must be non-negative"),
  }),
});

const getPollResults = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
});

const updatePoll = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(["draft", "scheduled", "active", "completed"]).optional(),
  }),
});

const deletePoll = z.object({
  params: z.object({
    id: z.string().min(1, "Poll ID is required"),
  }),
});

export const ChannelPollDto = {
  createPoll,
  getStationPolls,
  getAllPolls,
  getPollById,
  votePoll,
  getPollResults,
  updatePoll,
  deletePoll,
};
