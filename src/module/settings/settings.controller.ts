import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { SettingsService } from "./settings.service";
import { StatusCodes } from "http-status-codes";

const getSecuritySettings = catchAsync(async (_req: Request, res: Response) => {
  const result = await SettingsService.getSecuritySettings();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Security settings fetched successfully",
    data: result,
  });
});

const updateSecuritySettings = catchAsync(async (req: Request, res: Response) => {
  const adminUser = req.user as any;
  const adminAuthId = adminUser?.auth?._id?.toString() || adminUser?.auth?.toString() || adminUser?._id?.toString();
  const ipAddress = req.ip || req.socket.remoteAddress || "";
  const userAgent = req.headers["user-agent"] || "";

  const result = await SettingsService.updateSecuritySettings(req.body, {
    authId: adminAuthId,
    ipAddress,
    userAgent,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Security settings updated successfully",
    data: result,
  });
});

export const SettingsController = {
  getSecuritySettings,
  updateSecuritySettings,
};
