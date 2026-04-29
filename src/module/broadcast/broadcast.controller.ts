import { StatusCodes } from "http-status-codes";
import AppError from "errors/AppError";
import catchAsync from "@shared/catchAsync";
import sendResponse from "@shared/sendResponse";

import { BroadcastService } from "./broadcast.service";

// ─── Utility Helpers ─────────────────────────────────────────────────────────

const getBroadcastId = (req: { params: { id?: string } }) => {
  if (!req.params.id) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Broadcast ID is required");
  }

  return req.params.id;
};

// ─── Create Broadcast ────────────────────────────────────────────────────────
// Handles incoming requests to create a new broadcast channel/station.

const createBroadcast = catchAsync(async (req, res) => {
  const result = await BroadcastService.createBroadcast(req.body, req.user?._id);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Broadcast created successfully",
    data: result,
  });
});

// ─── List Broadcasts ─────────────────────────────────────────────────────────
// Retrieve a paginated array of available broadcasts, filtered by query params.

const listBroadcasts = catchAsync(async (req, res) => {
  const result = await BroadcastService.listBroadcasts(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Broadcasts fetched successfully",
    meta: result.meta,
    data: result.items,
  });
});

// ─── Get Broadcast ───────────────────────────────────────────────────────────
// Fetch detailed info for a single broadcast.

const getBroadcast = catchAsync(async (req, res) => {
  const result = await BroadcastService.getBroadcast(getBroadcastId(req), req.user?._id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Broadcast fetched successfully",
    data: result,
  });
});

// ─── Update Broadcast ────────────────────────────────────────────────────────
// Perform partial updates on broadcast data.

const updateBroadcast = catchAsync(async (req, res) => {
  const result = await BroadcastService.updateBroadcast(getBroadcastId(req), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Broadcast updated successfully",
    data: result,
  });
});

// ─── Delete Broadcast ────────────────────────────────────────────────────────
// Permanently remove a broadcast record.

const deleteBroadcast = catchAsync(async (req, res) => {
  const result = await BroadcastService.deleteBroadcast(getBroadcastId(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

// ─── Send Notification ───────────────────────────────────────────────────────
// Send push notifications specifically targeting followers of this broadcast.

const sendBroadcastNotification = catchAsync(async (req, res) => {
  const result = await BroadcastService.sendBroadcastNotification(getBroadcastId(req), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result.data,
  });
});

// ─── Upload Broadcast Images ─────────────────────────────────────────────────
// Handle logo and cover image uploads (local files or URL-based images).

const uploadBroadcastImages = catchAsync(async (req, res) => {
  const broadcastId = getBroadcastId(req);
  const uploadedFiles = req.files as Record<string, Express.Multer.File[]> | undefined;

  // Extract file paths from multer uploads or use URLs from body
  const imageData: Record<string, string | undefined> = {};

  // Check for uploaded logo file
  if (uploadedFiles?.logo && uploadedFiles.logo[0]) {
    const logoPath = uploadedFiles.logo[0].path
      .replace(/\\/g, "/")
      .split("uploads/")[1];
    imageData.logo = logoPath;
  } else if (req.body.logo && typeof req.body.logo === "string") {
    // Use URL from body if provided
    imageData.logo = req.body.logo;
  }

  // Check for uploaded cover image file
  if (uploadedFiles?.coverImage && uploadedFiles.coverImage[0]) {
    const coverPath = uploadedFiles.coverImage[0].path
      .replace(/\\/g, "/")
      .split("uploads/")[1];
    imageData.coverImage = coverPath;
  } else if (req.body.coverImage && typeof req.body.coverImage === "string") {
    // Use URL from body if provided
    imageData.coverImage = req.body.coverImage;
  }

  // If no images provided, return error
  if (!imageData.logo && !imageData.coverImage) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "At least one image (logo or coverImage) is required",
    );
  }

  const result = await BroadcastService.uploadBroadcastImages(broadcastId, imageData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Broadcast images uploaded successfully",
    data: result.broadcast,
  });
});

export const BroadcastController = {
  createBroadcast,
  listBroadcasts,
  getBroadcast,
  updateBroadcast,
  deleteBroadcast,
  sendBroadcastNotification,
  uploadBroadcastImages,
};