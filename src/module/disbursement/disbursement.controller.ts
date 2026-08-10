import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { DisbursementService } from "./disbursement.service";

const getDisbursements = catchAsync(async (req: Request, res: Response) => {
  const partnerId = req.user?.partnerId ? String(req.user.partnerId) : undefined;
  const countryId = req.user?.countryId ? String(req.user.countryId) : undefined;

  const result = await DisbursementService.getDisbursements(req.query, {
    partnerId,
    countryId,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Disbursements retrieved successfully",
    data: result.disbursements,
    meta: result.meta,
  });
});

export const DisbursementController = {
  getDisbursements,
};
