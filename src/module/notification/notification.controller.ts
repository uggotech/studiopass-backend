import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { NotificationService } from "./notification.service";
import { StatusCodes } from "http-status-codes";

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id.toString();
  const result = await NotificationService.getNotifications(userId, req.query as any);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notifications fetched successfully",
    data: result.notifications,
    meta: result.meta,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id.toString();
  const result = await NotificationService.getUnreadCount(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Unread count fetched successfully",
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id.toString();
  const result = await NotificationService.markAsRead(String(req.params.id), userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notification marked as read",
    data: result,
  });
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id.toString();
  const result = await NotificationService.markAllAsRead(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "All notifications marked as read",
    data: result,
  });
});

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id.toString();
  const result = await NotificationService.deleteNotification(String(req.params.id), userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notification deleted successfully",
    data: result,
  });
});

export const NotificationController = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
