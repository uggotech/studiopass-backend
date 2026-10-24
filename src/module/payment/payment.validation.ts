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

export const PaymentValidation = { initiatePayment, getPaymentStatus };
