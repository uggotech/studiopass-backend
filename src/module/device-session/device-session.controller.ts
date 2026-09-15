import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { DeviceSessionService } from "./device-session.service";

const getUserSessions = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await DeviceSessionService.getUserSessions(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User sessions retrieved successfully",
    data: result,
  });
});

const revokeSession = catchAsync(async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const result = await DeviceSessionService.revokeSession(sessionId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Session revoked successfully",
    data: result,
  });
});

const revokeAllUserSessions = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await DeviceSessionService.revokeAllUserSessions(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "All user sessions revoked successfully",
    data: result,
  });
});

const toggleDeviceApproval = catchAsync(async (req: Request, res: Response) => {
  const sessionId = req.params.sessionId as string;
  const { isApproved } = req.body;
  const adminUserId = (req.user as any)?._id?.toString();

  const result = await DeviceSessionService.toggleDeviceApproval(
    sessionId,
    Boolean(isApproved),
    adminUserId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Device ${isApproved ? "approved" : "unapproved"} successfully`,
    data: result,
  });
});

export const DeviceSessionController = {
  getUserSessions,
  revokeSession,
  revokeAllUserSessions,
  toggleDeviceApproval,
};
