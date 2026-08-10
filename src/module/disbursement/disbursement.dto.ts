import { z } from "zod";

export const disbursementQuerySchema = z.object({
  status: z.enum(["pending", "processing", "successful", "failed", "cancelled"]).optional(),
  station: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});
