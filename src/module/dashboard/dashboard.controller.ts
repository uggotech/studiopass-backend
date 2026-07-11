import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { DashboardService } from "./dashboard.service";

const getStats = catchAsync(async (req, res) => {
  const user = req.user as any;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
    role: user?.role,
  };

  const result = await DashboardService.getStats(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Dashboard stats fetched successfully",
    data: result,
  });
});

const getMessageActivity = catchAsync(async (req, res) => {
  const user = req.user as any;
  const { period = "monthly" } = req.query;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
  };

  const result = await DashboardService.getMessageActivity(
    period as "daily" | "weekly" | "monthly",
    scope,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Message activity fetched successfully",
    data: result,
  });
});

const getStationOverview = catchAsync(async (req, res) => {
  const user = req.user as any;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
  };

  const result = await DashboardService.getStationOverview(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station overview fetched successfully",
    data: result,
  });
});

const getRecentActivity = catchAsync(async (req, res) => {
  const user = req.user as any;
  const { limit = 10 } = req.query;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
  };

  const result = await DashboardService.getRecentActivity(Number(limit), scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Recent activity fetched successfully",
    data: result,
  });
});

const getTopStations = catchAsync(async (req, res) => {
  const user = req.user as any;
  const { limit = 5 } = req.query;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
  };

  const result = await DashboardService.getTopStations(Number(limit), scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Top stations fetched successfully",
    data: result,
  });
});

const getRecentUsers = catchAsync(async (req, res) => {
  const user = req.user as any;
  const { limit = 6 } = req.query;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
  };

  const result = await DashboardService.getRecentUsers(Number(limit), scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Recent users fetched successfully",
    data: result,
  });
});

const getCreditStats = catchAsync(async (req, res) => {
  const user = req.user as any;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
  };

  const result = await DashboardService.getCreditStats(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit stats fetched successfully",
    data: result,
  });
});

const getCountryRevenue = catchAsync(async (_req, res) => {
  const result = await DashboardService.getCountryRevenue();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Country revenue fetched successfully",
    data: result,
  });
});

export const DashboardController = {
  getStats,
  getMessageActivity,
  getStationOverview,
  getRecentActivity,
  getTopStations,
  getRecentUsers,
  getCreditStats,
  getCountryRevenue,
};
