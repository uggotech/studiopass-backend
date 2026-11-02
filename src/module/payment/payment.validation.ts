import { z } from "zod";

const initiatePayment = z.object({
  body: z.object({
    packageId: z.string().min(1, "Package is required"),
    phoneNumber: z.string().min(9, "Phone number is required").max(20),
  }),
});

const getPaymentStatus = z.object({
  params: z.object({
    transactionId: z.string().min(1).max(40),
  }),
});

// ── Super Admin ─────────────────────────────────────────────────────────────

const packageFields = z.object({
  label: z.string().trim().min(1, "Name is required").max(40),
  amountUgx: z.number().int("Price must be a whole number").min(100).max(2_000_000),
  credits: z.number().int("Credits must be a whole number").min(1).max(100_000),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
});

const createPackage = z.object({ body: packageFields });

const updatePackage = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: packageFields.partial().refine((b) => Object.keys(b).length > 0, "Nothing to update"),
});

const updatePayoutLimits = z.object({
  body: z
    .object({
      maxPerWinnerUgx: z.number().int().min(1),
      dailyLimitUgx: z.number().int().min(0),
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, "Nothing to update"),
});

export const PaymentValidation = {
  initiatePayment,
  getPaymentStatus,
  createPackage,
  updatePackage,
  updatePayoutLimits,
};
