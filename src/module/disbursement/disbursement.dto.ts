import { z } from "zod";

export const markPaidSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    // e.g. the MTN transaction id the accountant received after paying
    reference: z.string().trim().min(3, "Payment reference is required").max(100),
    note: z.string().trim().max(300).optional(),
  }),
});

export const disbursementQuerySchema = z.object({
  status: z.enum(["pending", "processing", "successful", "failed", "cancelled"]).optional(),
  station: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});
