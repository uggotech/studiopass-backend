import { z } from "zod";

const getDashboardStats = z.object({
  query: z.object({}),
});

const getMessageActivity = z.object({
  query: z.object({
    period: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
  }),
});

const getRecentActivity = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(50).default(10),
  }),
});

const getTopStations = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(20).default(5),
  }),
});

const getTopShows = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(20).default(5),
  }),
});

const getRecentUsers = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(20).default(6),
  }),
});

export const DashboardDto = {
  getDashboardStats,
  getMessageActivity,
  getRecentActivity,
  getTopStations,
  getTopShows,
  getRecentUsers,
};
