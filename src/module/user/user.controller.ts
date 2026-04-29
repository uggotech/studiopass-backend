import { StatusCodes } from "http-status-codes";
import AppError from "errors/AppError";
import catchAsync from "@shared/catchAsync";
import sendResponse from "@shared/sendResponse";
import { UserService } from "./user.service";

const getMe = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const user = await UserService.getMe(userId, req.query);

  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Profile fetched successfully", data: user });
});

const getById = catchAsync(async (req, res) => {
  const user = await UserService.getById(req.params.id as string, req.query);

  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "User fetched successfully", data: user });
});

const updateProfile = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await UserService.updateProfile(userId, req.body);

  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Profile updated successfully", data: result });
});

const deleteMe = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await UserService.deleteMe(userId);

  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: result.message, data: null });
});

const updateAvatar = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const imageFile = files?.image?.[0];
  if (!imageFile) throw new AppError(StatusCodes.BAD_REQUEST, "Avatar image is required");

  const result = await UserService.updateAvatar(userId, imageFile);

  sendResponse(res, { statusCode: StatusCodes.OK, success: true, message: "Avatar updated successfully", data: result });
});

export const UserController = {
  getMe,
  getById,
  updateProfile,
  deleteMe,
  updateAvatar,
};

