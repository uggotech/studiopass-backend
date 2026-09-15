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

const getClientIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }
  return req.ip || req.socket.remoteAddress || "Unknown IP";
};

const login = catchAsync(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const result = await AuthService.login({
    ...req.body,
    ipAddress,
    userAgent,
  });

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
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const result = await AuthService.changePassword(authId, {
    ...req.body,
    ipAddress,
    userAgent,
    userId: user._id?.toString(),
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Password changed successfully",
    data: result,
  });
});

const verify2FALogin = catchAsync(async (req: Request, res: Response) => {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const result = await AuthService.verify2FALogin({
    ...req.body,
    ipAddress,
    userAgent,
  });

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
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const result = await AuthService.setup2FAEnable(
    {
      ...req.body,
      ipAddress,
      userAgent,
    },
    authenticatedAuthId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Two-Factor authentication configured and enabled successfully",
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
  const ipAddress = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const result = await AuthService.disable2FA(authId, {
    ...req.body,
    ipAddress,
    userAgent,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Two-Factor authentication disabled",
    data: result,
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  const sessionId = (req.user as any)?.sid as string | undefined;
  const userId = req.user!._id.toString();

  if (sessionId) {
    const { DeviceSessionService } = await import("../device-session/device-session.service");
    await DeviceSessionService.logoutOwnSession(sessionId, userId);
  }

  // Also blacklist current refresh token if provided
  const refreshToken = (req.body as any)?.refreshToken as string | undefined;
  if (refreshToken) {
    try {
      const { default: redisClient } = await import("../../redis/redisClient");
      await redisClient.set(`revoked_token:${refreshToken}`, "1", 7 * 24 * 3600);
    } catch {}
  }

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Logged out successfully",
    data: null,
  });
});

export const AuthController = {
  initiate,
  verifyOtp,
  login,
  verify2FALogin,
  setup2FAEnable,
  init2FASetup,
  disable2FA,
  refresh,
  changePassword,
  logout,
};
