import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;

const getAllStatements = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    type: z.enum(["Call", "Message"]).optional(),
    station: z.string().regex(objectIdRegex, "Invalid station ID format").optional(),
    country: z.string().regex(objectIdRegex, "Invalid country ID format").optional(),
    isFree: z.enum(["true", "false"]).optional(),
    search: z.string().max(200).optional(),
    startDate: z.string().regex(isoDateRegex, "Invalid date format (use YYYY-MM-DD)").optional(),
    endDate: z.string().regex(isoDateRegex, "Invalid date format (use YYYY-MM-DD)").optional(),
  }),
});

const getStatementById = z.object({
  params: z.object({
    id: z.string().regex(objectIdRegex, "Invalid statement ID format"),
  }),
});

const getKPIs = z.object({
  query: z.object({
    startDate: z.string().regex(isoDateRegex, "Invalid date format (use YYYY-MM-DD)").optional(),
    endDate: z.string().regex(isoDateRegex, "Invalid date format (use YYYY-MM-DD)").optional(),
    station: z.string().regex(objectIdRegex, "Invalid station ID format").optional(),
  }),
});

export const ListenerStatementDto = {
  getAllStatements,
  getStatementById,
  getKPIs,
};
