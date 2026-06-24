import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ShowService } from "./show.service";
import { StatusCodes } from "http-status-codes";

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

export const ShowController = {
  getAllShows,
  getShowById,
  createShow,
  getMyShows,
};
