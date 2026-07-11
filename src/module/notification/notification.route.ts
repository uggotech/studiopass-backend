import { Router } from "express";
import { NotificationController } from "./notification.controller";
import { NotificationDto } from "./notification.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// All notification routes require authentication — users see only their own
const allowedRoles = [
  UserRole.USER,
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.STATION_ADMIN,
  UserRole.MEDIA_STATION,
  UserRole.PRESENTER,
  UserRole.CUSTOMER_CARE,
];

router.get(
  "/unread-count",
  auth(...allowedRoles),
  NotificationController.getUnreadCount,
);

router.patch(
  "/read-all",
  auth(...allowedRoles),
  NotificationController.markAllAsRead,
);

router.get(
  "/",
  auth(...allowedRoles),
  validateRequest(NotificationDto.getNotifications),
  NotificationController.getNotifications,
);

router.patch(
  "/:id/read",
  auth(...allowedRoles),
  validateRequest(NotificationDto.markAsRead),
  NotificationController.markAsRead,
);

router.delete(
  "/:id",
  auth(...allowedRoles),
  validateRequest(NotificationDto.deleteNotification),
  NotificationController.deleteNotification,
);

export const NotificationRoutes = router;
