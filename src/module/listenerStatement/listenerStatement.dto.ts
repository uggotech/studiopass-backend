import { z } from "zod";

const getAllStatements = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    type: z.enum(["Call", "Message"]).optional(),
    station: z.string().optional(),
    country: z.string().optional(),
    search: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

const getStatementById = z.object({
  params: z.object({
    id: z.string().min(1, "Statement ID is required"),
  }),
});

const getKPIs = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    station: z.string().optional(),
  }),
});

export const ListenerStatementDto = {
  getAllStatements,
  getStatementById,
  getKPIs,
};
