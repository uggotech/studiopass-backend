import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { StationService } from "./station.service";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";

const getAllStations = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = user?.partnerId ? { partnerId: user.partnerId.toString() } : undefined;
  const result = await StationService.getAllStations(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Stations fetched successfully",
    data: result.stations,
    meta: result.meta,
  });
});

const getStationById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = String(req.params.id);

  // Scope check: station_admin can only view their own station
  if (user.role === "station_admin") {
    if (!user.stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station assigned to this user");
    }
    if (user.stationId.toString() !== stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view your own station");
    }
  }

  const result = await StationService.getStationById(stationId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station fetched successfully",
    data: result,
  });
});

const createStationWithAdmin = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  // If partner_admin, force their partnerId
  const partnerId = user?.role === "partner_admin"
    ? user.partnerId?.toString()
    : req.body.partnerId;

  const result = await StationService.createStationWithAdmin(
    { ...req.body, partnerId },
    user?._id?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Station and admin created successfully",
    data: result,
  });
});

const updateStation = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = String(req.params.id);

  // Scope check: station_admin can only update their own station
  if (user.role === "station_admin") {
    if (!user.stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station assigned to this user");
    }
    if (user.stationId.toString() !== stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only update your own station");
    }
  }

  const result = await StationService.updateStation(stationId, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station updated successfully",
    data: result,
  });
});

const deactivateStation = catchAsync(async (req: Request, res: Response) => {
  const result = await StationService.deactivateStation(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station deactivated successfully",
    data: result,
  });
});

const reactivateStation = catchAsync(async (req: Request, res: Response) => {
  const result = await StationService.reactivateStation(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station reactivated successfully",
    data: result,
  });
});

const getPublicStations = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userId = user?._id?.toString();
  const result = await StationService.getPublicStations(req.query, userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Stations fetched successfully",
    data: result.stations,
    meta: result.meta,
  });
});

export const StationController = {
  getAllStations,
  getStationById,
  getPublicStations,
  createStationWithAdmin,
  updateStation,
  deactivateStation,
  reactivateStation,
};
