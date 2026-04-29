import { StatusCodes } from "http-status-codes";

import AppError from "errors/AppError";
import catchAsync from "@shared/catchAsync";
import sendResponse from "@shared/sendResponse";

import { NotificationService } from "./notification.service";

// ─── Utility Helpers ─────────────────────────────────────────────────────────

const getNotificationId = (req: { params: { id?: string } }) => {
  if (!req.params.id) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Notification ID is required");
  }

  return req.params.id;
};

// ─── Register Device Token ───────────────────────────────────────────────────
// Assign an FCM token to the currently authenticated user for push notifications.

const registerToken = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await NotificationService.registerDeviceToken(userId, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Device token registered successfully",
    data: result,
  });
});

// ─── Remove Device Token ─────────────────────────────────────────────────────
// Remove an FCM token (e.g. upon user logging out).

const removeToken = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await NotificationService.removeDeviceToken(userId, req.body.token);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

// ─── List Notifications ──────────────────────────────────────────────────────
// Fetch a paginated list of all notifications targeted towards the user.

const listNotifications = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await NotificationService.listNotifications(userId, req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notifications fetched successfully",
    meta: result.meta,
    data: result.items,
  });
});

// ─── Get Unread Count ────────────────────────────────────────────────────────
// Retrieve the number of unread notifications for a user to display a badge.

const getUnreadCount = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const count = await NotificationService.getUnreadCount(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Unread notification count fetched successfully",
    data: { count },
  });
});

// ─── Mark As Read ────────────────────────────────────────────────────────────
// Note a single notification as read by the user.

const markAsRead = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await NotificationService.markAsRead(userId, getNotificationId(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notification marked as read",
    data: result.notification,
  });
});

// ─── Mark All As Read ────────────────────────────────────────────────────────
// Bulk update all user's unread notifications to 'read' status.

const markAllAsRead = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await NotificationService.markAllAsRead(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

// ─── Delete Notification ─────────────────────────────────────────────────────
// Delete a specific past notification individually.

const deleteNotification = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await NotificationService.removeNotification(userId, getNotificationId(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const NotificationController = {
  registerToken,
  removeToken,
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};