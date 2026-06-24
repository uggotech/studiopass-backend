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

export const AuthController = { initiate, verifyOtp, login, refresh };
