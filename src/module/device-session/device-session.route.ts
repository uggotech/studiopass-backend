import { Router } from "express";
import { DeviceSessionController } from "./device-session.controller";
import auth from "../../middlewares/auth";
import { UserRole } from "../../shared/roles";

const router = Router();

// List active and past sessions for a user (Super Admin + Station Admin)
router.get(
  "/user/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  DeviceSessionController.getUserSessions
);

// Remote logout a specific session (Super Admin + Station Admin)
router.post(
  "/:sessionId/remote-logout",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  DeviceSessionController.revokeSession
);

// Remote logout all sessions for a user (Super Admin + Station Admin)
router.post(
  "/user/:id/remote-logout-all",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  DeviceSessionController.revokeAllUserSessions
);

// Toggle whether a device is an approved studio device (Super Admin + Station Admin)
router.patch(
  "/:sessionId/toggle-approval",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  DeviceSessionController.toggleDeviceApproval
);

export const DeviceSessionRoutes = router;
