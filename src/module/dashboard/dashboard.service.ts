import { DashboardRepository } from "./dashboard.repository";

export interface DashboardScope {
  partnerId?: string;
  stationId?: string;
  country?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  dateRange?: string;
}

const getStats = async (scope?: DashboardScope) => {
  return DashboardRepository.getStats(scope);
};

const getMessageActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: DashboardScope,
  timezone?: string,
) => {
  return DashboardRepository.getMessageActivity(period, scope, timezone);
};

const getRevenueActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: DashboardScope,
  timezone?: string,
) => {
  return DashboardRepository.getRevenueActivity(period, scope, timezone);
};

const getListenerActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: DashboardScope,
  timezone?: string,
) => {
  return DashboardRepository.getListenerActivity(period, scope, timezone);
};

const getCampaignActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: DashboardScope,
  timezone?: string,
) => {
  return DashboardRepository.getCampaignActivity(period, scope, timezone);
};

const getStationOverview = async (scope?: DashboardScope) => {
  return DashboardRepository.getStationOverview(scope);
};

const getRecentActivity = async (
  limit: number,
  scope?: DashboardScope,
) => {
  return DashboardRepository.getRecentActivity(limit, scope);
};

const getTopStations = async (
  limit: number,
  scope?: DashboardScope,
) => {
  return DashboardRepository.getTopStations(limit, scope);
};

const getTopShows = async (
  limit: number,
  scope?: DashboardScope,
) => {
  return DashboardRepository.getTopShows(limit, scope);
};

const getRecentUsers = async (
  limit: number,
  scope?: DashboardScope,
) => {
  return DashboardRepository.getRecentUsers(limit, scope);
};

const getCreditStats = async (scope?: DashboardScope) => {
  return DashboardRepository.getCreditStats(scope);
};

const getCountryRevenue = async (scope?: DashboardScope) => {
  return DashboardRepository.getCountryRevenue(scope);
};

const getCallActivity = async (
  period: "daily" | "weekly" | "monthly",
  scope?: DashboardScope,
  timezone?: string,
) => {
  return DashboardRepository.getCallActivity(period, scope, timezone);
};

const getCampaignStats = async (scope?: DashboardScope) => {
  return DashboardRepository.getCampaignStats(scope);
};

const getCallOperationsStats = async (scope?: DashboardScope) => {
  return DashboardRepository.getCallOperationsStats(scope);
};

const getRoleDistribution = async () => {
  return DashboardRepository.getRoleDistribution();
};

export const DashboardService = {
  getStats,
  getMessageActivity,
  getRevenueActivity,
  getListenerActivity,
  getCampaignActivity,
  getCallActivity,
  getCampaignStats,
  getCallOperationsStats,
  getRoleDistribution,
  getStationOverview,
  getRecentActivity,
  getTopStations,
  getTopShows,
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};

