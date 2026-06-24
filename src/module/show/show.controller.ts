import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ShowService } from "./show.service";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";

const getShowsByStation = catchAsync(async (req: Request, res: Response) => {
  const stationId = String(req.query.station);
  if (!stationId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
  }

  const result = await ShowService.getShowsByStation(stationId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Shows fetched successfully",
    data: result,
  });
});

export const ShowController = {
  getShowsByStation,
};
