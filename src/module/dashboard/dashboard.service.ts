import { DashboardRepository } from "./dashboard.repository";

const getStats = async (scope?: { partnerId?: string; stationId?: string; role?: string }) => {
  return DashboardRepository.getStats(scope);
};

const getMessageActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: { partnerId?: string; stationId?: string },
) => {
  return DashboardRepository.getMessageActivity(period, scope);
};

const getStationOverview = async (scope?: { partnerId?: string; stationId?: string }) => {
  return DashboardRepository.getStationOverview(scope);
};

const getRecentActivity = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string },
) => {
  return DashboardRepository.getRecentActivity(limit, scope);
};

const getTopStations = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string },
) => {
  return DashboardRepository.getTopStations(limit, scope);
};

const getRecentUsers = async (
  limit: number,
  scope?: { partnerId?: string; stationId?: string },
) => {
  return DashboardRepository.getRecentUsers(limit, scope);
};

const getCreditStats = async (scope?: { partnerId?: string; stationId?: string }) => {
  return DashboardRepository.getCreditStats(scope);
};

const getCountryRevenue = async () => {
  return DashboardRepository.getCountryRevenue();
};

export const DashboardService = {
  getStats,
  getMessageActivity,
  getStationOverview,
  getRecentActivity,
  getTopStations,
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};
