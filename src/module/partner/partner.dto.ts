import { z } from "zod";
import { passwordSchema } from "../../shared/validators/password.validator";

const createPartnerWithAdmin = z.object({
  body: z.object({
    partnerName: z.string().min(1, "Partner name is required").trim(),
    countryId: z.string().min(1, "Country ID is required"),
    contactEmail: z.string().email("Invalid email").optional(),
    contactPhone: z.string().optional(),
    adminFullName: z.string().min(1, "Admin full name is required").trim(),
    adminUsername: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(30)
      .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
    adminPassword: passwordSchema,
  }),
});

const updatePartner = z.object({
  body: z.object({
    name: z.string().min(1).trim().optional(),
    contactEmail: z.string().email("Invalid email").optional(),
    contactPhone: z.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  }),
});

export const PartnerDto = { createPartnerWithAdmin, updatePartner };
