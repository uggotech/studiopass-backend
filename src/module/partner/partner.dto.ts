import { z } from "zod";

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
    adminPassword: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .max(100),
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
