import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { AdminActor, PaymentAdminService } from "./payment.admin.service";

const actorOf = (req: Request): AdminActor => {
  const user = req.user as any;
  return {
    authId: user?.auth?._id?.toString() || user?.auth?.toString() || user?._id?.toString(),
    userId: user?._id?.toString(),
    ipAddress: req.ip || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
};

const listPackages = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit packages retrieved",
    data: await PaymentAdminService.listPackages(),
  });
});

const createPackage = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Credit package created",
    data: await PaymentAdminService.createPackage(req.body, actorOf(req)),
  });
});

const updatePackage = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit package updated",
    data: await PaymentAdminService.updatePackage(String(req.params.id), req.body, actorOf(req)),
  });
});

const getLimits = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payout limits retrieved",
    data: await PaymentAdminService.getLimits(),
  });
});

const updateLimits = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payout limits updated",
    data: await PaymentAdminService.updateLimits(req.body, actorOf(req)),
  });
});

export const PaymentAdminController = {
  listPackages,
  createPackage,
  updatePackage,
  getLimits,
  updateLimits,
};
