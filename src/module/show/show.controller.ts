import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ShowService } from "./show.service";
import { StationRepository } from "../station/station.repository";
import { Country } from "../country/country.model";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";

const getAllShows = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope: { partnerId?: string; stationId?: string } = {};

  if (user?.stationId) scope.stationId = user.stationId.toString();
  else if (user?.partnerId) scope.partnerId = user.partnerId.toString();
  // super_admin: no scope — sees all

  const result = await ShowService.getAllShows(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Shows fetched successfully",
    data: result.shows,
    meta: result.meta,
  });
});

const getShowById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const result = await ShowService.getShowById(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Show fetched successfully",
    data: result,
  });
});

const createShow = catchAsync(async (req: Request, res: Response) => {
  const result = await ShowService.createShow(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Show created successfully",
    data: result,
  });
});

const getMyShows = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userId = user._id.toString();

  const result = await ShowService.getMyShows(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.assigned ? "Shows fetched successfully" : "No shows assigned",
    data: result,
  });
});

const getActiveShow = catchAsync(async (req: Request, res: Response) => {
  const { stationId } = req.params as { stationId: string };

  // Auto-lookup station's timezone from DB
  let timezone = "UTC";
  const station = await StationRepository.findById(stationId);
  if (station?.country) {
    const countryId = (station.country as any)?._id || station.country;
    const country = await Country.findById(countryId).lean();
    if (country?.timezone) timezone = country.timezone;
  }

  const show = await ShowService.getActiveShow(stationId, timezone);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: show ? "Active show found" : "No active show",
    data: show,
  });
});

const updateShow = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { id } = req.params as { id: string };
  const scope: { partnerId?: string; stationId?: string } = {};
  if (user?.stationId) scope.stationId = user.stationId.toString();
  else if (user?.partnerId) scope.partnerId = user.partnerId.toString();

  const result = await ShowService.updateShow(id, req.body, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Show updated successfully",
    data: result,
  });
});

const getLiveStats = catchAsync(async (req: Request, res: Response) => {
  const { stationId } = req.params as { stationId: string };
  const user = req.user as any;

  // Tenant scope: live stats include the caller currently on air (name / phone / avatar)
  if (user.role === "partner_admin") {
    const station = await StationRepository.findById(stationId);
    const stationPartnerId = (station as any)?.partner?._id?.toString() || (station as any)?.partner?.toString();
    if (!station || !user.partnerId || stationPartnerId !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view live stats of stations under your partner.");
    }
  } else if (user.role !== "super_admin") {
    if (!user.stationId || user.stationId.toString() !== stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view live stats of your own station.");
    }
  }

  // A Media Station only sees the call IT is handling as "on speaker"
  const operatorId = user.role === "media_station" ? user._id.toString() : undefined;
  const result = await ShowService.getLiveStats(stationId, operatorId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Live show stats fetched successfully",
    data: result,
  });
});

export const ShowController = {
  getAllShows,
  getShowById,
  createShow,
  getMyShows,
  getActiveShow,
  getLiveStats,
  updateShow,
};
