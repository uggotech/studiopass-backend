import { StatusCodes } from "http-status-codes";
import { Request } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { DashboardService } from "./dashboard.service";

const buildScope = (req: Request) => {
  const user = req.user as any;
  const role = user?.role;

  let partnerId = req.query.partnerId as string | undefined;
  let stationId = req.query.stationId as string | undefined;
  let country = req.query.country as string | undefined;

  if (role === "station_admin" || role === "media_station" || role === "presenter") {
    stationId = user?.stationId?.toString();
    partnerId = undefined;
    country = undefined;
  } else if (role === "partner_admin" || role === "customer_care") {
    partnerId = user?.partnerId?.toString();
    country = undefined;
  }

  return {
    role,
    partnerId,
    stationId,
    country,
    startDate: req.query.startDate as string | undefined,
    endDate: req.query.endDate as string | undefined,
    dateRange: req.query.dateRange as string | undefined,
  };
};

const getStats = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const result = await DashboardService.getStats(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Dashboard stats fetched successfully",
    data: result,
  });
});

const getMessageActivity = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { period = "monthly", timezone } = req.query;

  const result = await DashboardService.getMessageActivity(
    period as "daily" | "weekly" | "monthly",
    scope,
    timezone as string | undefined,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Message activity fetched successfully",
    data: result,
  });
});

const getRevenueActivity = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { period = "monthly", timezone } = req.query;

  const result = await DashboardService.getRevenueActivity(
    period as "daily" | "weekly" | "monthly",
    scope,
    timezone as string | undefined,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Revenue activity fetched successfully",
    data: result,
  });
});

const getListenerActivity = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { period = "monthly", timezone } = req.query;

  const result = await DashboardService.getListenerActivity(
    period as "daily" | "weekly" | "monthly",
    scope,
    timezone as string | undefined,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Listener activity fetched successfully",
    data: result,
  });
});

const getCampaignActivity = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { period = "monthly", timezone } = req.query;

  const result = await DashboardService.getCampaignActivity(
    period as "daily" | "weekly" | "monthly",
    scope,
    timezone as string | undefined,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Campaign activity fetched successfully",
    data: result,
  });
});

const getStationOverview = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const result = await DashboardService.getStationOverview(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station overview fetched successfully",
    data: result,
  });
});

const getRecentActivity = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { limit = 10 } = req.query;

  const result = await DashboardService.getRecentActivity(Number(limit), scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Recent activity fetched successfully",
    data: result,
  });
});

const getTopStations = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { limit = 5 } = req.query;

  const result = await DashboardService.getTopStations(Number(limit), scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Top stations fetched successfully",
    data: result,
  });
});

const getRecentUsers = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { limit = 6 } = req.query;

  const result = await DashboardService.getRecentUsers(Number(limit), scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Recent users fetched successfully",
    data: result,
  });
});

const getCreditStats = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const result = await DashboardService.getCreditStats(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit stats fetched successfully",
    data: result,
  });
});

const getCountryRevenue = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const result = await DashboardService.getCountryRevenue(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Country revenue fetched successfully",
    data: result,
  });
});

const getCallActivity = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const { period = "monthly", timezone } = req.query;

  const result = await DashboardService.getCallActivity(
    period as "daily" | "weekly" | "monthly",
    scope,
    timezone as string | undefined,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Call activity fetched successfully",
    data: result,
  });
});

const getCampaignStats = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const result = await DashboardService.getCampaignStats(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Campaign stats fetched successfully",
    data: result,
  });
});

const getCallOperationsStats = catchAsync(async (req, res) => {
  const scope = buildScope(req);
  const result = await DashboardService.getCallOperationsStats(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Call operations stats fetched successfully",
    data: result,
  });
});

const getRoleDistribution = catchAsync(async (_req, res) => {
  const result = await DashboardService.getRoleDistribution();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User role distribution fetched successfully",
    data: result,
  });
});

export const DashboardController = {
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
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};

