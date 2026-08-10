import { z } from "zod";

export const prizeTypeQuerySchema = z.object({
  isActive: z.string().optional(),
});
