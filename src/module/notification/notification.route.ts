import { Router } from "express";

import auth from "@middlewares/auth";
import validateRequest from "@middlewares/validateRequest";

import { NotificationController } from "./notification.controller";
import { NotificationDto } from "./notification.dto";

const router = Router();

// Apply authentication to all following routes
router.use(auth());

/**
 * @route   POST /api/v1/notifications/token
 * @desc    Register a new FCM device token for the authenticated user
 * @access  Private
 */
router.post(
  "/token",
  validateRequest(NotificationDto.registerToken),
  NotificationController.registerToken,
);

/**
 * @route   DELETE /api/v1/notifications/token
 * @desc    Remove/unregister an FCM device token for the user upon logout or token expiration
 * @access  Private
 */
router.delete(
  "/token",
  validateRequest(NotificationDto.removeToken),
  NotificationController.removeToken,
);

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Get the total number of unread notifications for the user
 * @access  Private
 */
router.get("/unread-count", NotificationController.getUnreadCount);

/**
 * @route   GET /api/v1/notifications
 * @desc    List user's notifications with pagination (sorted by newest, unread first usually)
 * @access  Private
 */
router.get("/", NotificationController.listNotifications);

/**
 * @route   PATCH /api/v1/notifications/read-all
 * @desc    Mark all unread notifications of the user as read
 * @access  Private
 */
router.patch("/read-all", NotificationController.markAllAsRead);

/**
 * @route   PATCH /api/v1/notifications/:id/read
 * @desc    Mark a specific individual notification as read
 * @access  Private
 */
router.patch("/:id/read", NotificationController.markAsRead);

/**
 * @route   DELETE /api/v1/notifications/:id
 * @desc    Delete a specific notification from the user's list
 * @access  Private
 */
router.delete("/:id", NotificationController.deleteNotification);

export const NotificationRoutes = router;