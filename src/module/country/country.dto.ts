import { z } from "zod";

const createCountry = z.object({
  body: z.object({
    name: z.string().min(1).trim(),
    code: z.string().length(2).toUpperCase(),
    phoneCode: z.string().min(1).trim(),
    currency: z.string().min(1).trim(),
    currencySymbol: z.string().min(1).trim(),
    timezone: z.string().min(1),
    messageCreditPrice: z.number().min(0),
    callCreditPrice: z.number().min(0),
    smsProviders: z.array(z.string()).min(1).default(["africas_talking"]),
  }),
});

const updateCountry = z.object({
  body: z.object({
    name: z.string().min(1).trim().optional(),
    phoneCode: z.string().min(1).trim().optional(),
    currency: z.string().min(1).trim().optional(),
    currencySymbol: z.string().min(1).trim().optional(),
    timezone: z.string().min(1).optional(),
    messageCreditPrice: z.number().min(0).optional(),
    callCreditPrice: z.number().min(0).optional(),
    smsProviders: z.array(z.string()).min(1).optional(),
  }),
});

export const CountryDto = { createCountry, updateCountry };
