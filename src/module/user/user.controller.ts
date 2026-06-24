import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { UserService } from "./user.service";
import { StatusCodes } from "http-status-codes";

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.getMyProfile(user._id.toString());

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Profile fetched successfully",
    data: result,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  // processAndUpload middleware puts the file path in req.body.image
  const avatar = req.body.image || undefined;
  const result = await UserService.updateMyProfile(user._id.toString(), {
    ...req.body,
    ...(avatar && { avatar }),
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Profile updated successfully",
    data: result,
  });
});

const updateMyPreferences = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.updateMyPreferences(user._id.toString(), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Preferences updated successfully",
    data: result,
  });
});

const getAllStationAdmins = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = user?.partnerId ? { partnerId: user.partnerId.toString() } : undefined;
  const result = await UserService.getAllStationAdmins(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station admins fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const getAllMediaStationUsers = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope: { partnerId?: string; stationId?: string } = {};
  if (user?.stationId) scope.stationId = user.stationId.toString();
  else if (user?.partnerId) scope.partnerId = user.partnerId.toString();

  const result = await UserService.getAllMediaStationUsers(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Media station users fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const createMediaStation = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.createMediaStation(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Media station user created successfully",
    data: result,
  });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getUserById(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User fetched successfully",
    data: result,
  });
});

const deactivateUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.deactivateUser(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User deactivated successfully",
    data: result,
  });
});

const reactivateUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.reactivateUser(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User reactivated successfully",
    data: result,
  });
});

export const UserController = {
  getMyProfile,
  updateMyProfile,
  updateMyPreferences,
  getAllStationAdmins,
  getAllMediaStationUsers,
  createMediaStation,
  getUserById,
  deactivateUser,
  reactivateUser,
};
