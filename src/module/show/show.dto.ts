import { z } from "zod";

const daysEnum = z.enum([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
]);

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const createShow = z.object({
  body: z.object({
    name: z.string().min(1, "Name is required").max(100),
    stationId: z.string().min(1, "Station ID is required"),
    presenterId: z.string().optional(),
    startTime: z.string().regex(timeRegex, "Start time must be in HH:mm format"),
    endTime: z.string().regex(timeRegex, "End time must be in HH:mm format"),
    days: z.array(daysEnum).min(1, "At least one day is required"),
    description: z.string().max(500).optional(),
  }).refine((data) => data.startTime !== data.endTime, {
    message: "Start time and end time cannot be the same",
    path: ["endTime"],
  }),
});

const updateShow = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    stationId: z.string().optional(),
    presenterId: z.string().nullable().optional(),
    startTime: z.string().regex(timeRegex, "Start time must be in HH:mm format").optional(),
    endTime: z.string().regex(timeRegex, "End time must be in HH:mm format").optional(),
    days: z.array(daysEnum).min(1, "At least one day is required").optional(),
    description: z.string().max(500).optional(),
    status: z.enum(["Active", "Scheduled", "Inactive"]).optional(),
  }),
});

export const ShowDto = {
  createShow,
  updateShow,
};
