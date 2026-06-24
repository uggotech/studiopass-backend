import { z } from "zod";

const addCredits = z.object({
  body: z.object({
    userId: z.string().min(1, "User ID is required"),
    amount: z.number().int().positive("Amount must be a positive integer"),
    isFree: z.boolean().optional().default(true),
  }),
});

const getBalance = z.object({
  query: z.object({
    userId: z.string().optional(),
  }),
});

export const CreditDto = { addCredits, getBalance };
