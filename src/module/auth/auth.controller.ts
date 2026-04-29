import { StatusCodes } from "http-status-codes";
import catchAsync from "@shared/catchAsync";
import sendResponse from "@shared/sendResponse";
import { AuthService } from "./auth.service";

const initiateAuth = catchAsync(async (req, res) => {
  const result = await AuthService.initiateAuth(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.data,
  });
});

const verifyOtp = catchAsync(async (req, res) => {
  const result = await AuthService.verifyOtp(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.data,
  });
});

const resendOtp = catchAsync(async (req, res) => {
  const result = await AuthService.resendOtp(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.data,
  });
});

const refreshAccessToken = catchAsync(async (req, res) => {
  const result = await AuthService.refreshAccessToken(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Access token refreshed successfully",
    data: result.data,
  });
});

export const AuthController = {
  initiateAuth,
  verifyOtp,
  resendOtp,
  refreshAccessToken,
};

