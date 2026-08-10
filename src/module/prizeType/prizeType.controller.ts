import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { PrizeTypeService } from "./prizeType.service";

const getPrizeTypes = catchAsync(async (_req: Request, res: Response) => {
  const prizeTypes = await PrizeTypeService.getAllPrizeTypes();
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Prize types retrieved successfully",
    data: prizeTypes,
  });
});

export const PrizeTypeController = {
  getPrizeTypes,
};
