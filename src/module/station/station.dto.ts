import { z } from "zod";

const createStationWithAdmin = z.object({
  body: z.object({
    name: z.string().min(1, "Station name is required").trim(),
    stationCode: z
      .string()
      .min(3, "Station code must be at least 3 characters")
      .max(20)
      .regex(/^[a-zA-Z0-9-]+$/, "Station code can only contain letters, numbers, and hyphens"),
    category: z.enum(["radio", "tv", "channel"], { message: "Category must be radio, tv, or channel" }),
    countryId: z.string().min(1, "Country is required").optional(),
    partnerId: z.string().min(1, "Partner is required").optional(),
    description: z.string().optional(),
    website: z.string().url("Invalid URL").optional().or(z.literal("")),
    adminFullName: z.string().min(1, "Admin full name is required").trim(),
    adminUsername: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(30)
      .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, underscores only"),
    adminPassword: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .max(100),
  }),
});

const updateStation = z.object({
  body: z.object({
    name: z.string().min(1).trim().optional(),
    description: z.string().optional(),
    website: z.string().url("Invalid URL").optional().or(z.literal("")),
    logo: z.string().optional(),
    coverImage: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const StationDto = { createStationWithAdmin, updateStation };
