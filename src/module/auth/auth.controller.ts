import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { AuthService } from "./auth.service";
import { StatusCodes } from "http-status-codes";

const initiate = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.initiate(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "OTP sent successfully",
    data: result,
  });
});

const verifyOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.verifyOtp(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "OTP verified successfully",
    data: result,
  });
});

const login = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.login(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Login successful",
    data: result,
  });
});

const refresh = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.refresh(req.body.refreshToken);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Token refreshed successfully",
    data: result,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const authId = user.auth ? user.auth.toString() : user._id.toString();
  const result = await AuthService.changePassword(authId, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Password changed successfully",
    data: result,
  });
});

const verify2FALogin = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.verify2FALogin(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Two-Factor authentication verified successfully",
    data: result,
  });
});

const setup2FAEnable = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const authenticatedAuthId = user?.auth ? user.auth.toString() : user?._id?.toString();
  const result = await AuthService.setup2FAEnable(req.body, authenticatedAuthId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Two-Factor authentication configured and enabled successfully",
    data: result,
  });
});

const skip2FASetup = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.skip2FASetup(req.body.tempToken);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "2FA setup skipped. Logged in successfully",
    data: result,
  });
});

const init2FASetup = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const authId = user.auth?._id?.toString() || user.auth?.toString() || user._id?.toString();
  const result = await AuthService.init2FASetup(authId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "2FA setup initialized",
    data: result,
  });
});

const disable2FA = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const authId = user.auth?._id?.toString() || user.auth?.toString() || user._id?.toString();
  const result = await AuthService.disable2FA(authId, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Two-Factor authentication disabled",
    data: result,
  });
});

export const AuthController = {
  initiate,
  verifyOtp,
  login,
  verify2FALogin,
  setup2FAEnable,
  skip2FASetup,
  init2FASetup,
  disable2FA,
  refresh,
  changePassword,
};
