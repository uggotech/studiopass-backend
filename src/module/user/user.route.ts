import { Router } from "express";
import { UserController } from "./user.controller";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserDto } from "./user.dto";
import processAndUpload from "../../middlewares/processAndUpload";

const router = Router();

// App users: get my profile
router.get("/profile", auth(UserRole.USER), UserController.getMyProfile);

// App users: update my profile (with optional avatar upload)
router.patch(
  "/profile",
  auth(UserRole.USER),
  processAndUpload,
  UserController.updateMyProfile,
);

// App users: update preferences
router.patch(
  "/profile/preferences",
  auth(UserRole.USER),
  validateRequest(UserDto.updatePreferences),
  UserController.updateMyPreferences,
);

// Super admin + partner admin: list station admins
router.get(
  "/station-admins",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  UserController.getAllStationAdmins,
);

// Super admin + partner admin + station admin: list media station users
router.get(
  "/media-stations",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.getAllMediaStationUsers,
);

// Super admin + partner admin + station admin: create media station user
router.post(
  "/create-media-station",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.createMediaStation,
);

// Super admin + partner admin + station admin: list presenters
router.get(
  "/presenters",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.getAllPresenters,
);

// Super admin + partner admin + station admin: create presenter
router.post(
  "/create-presenter",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.createPresenter,
);

// Super admin + partner admin: get single user
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  UserController.getUserById,
);

// Super admin + partner admin: deactivate user
router.patch(
  "/:id/deactivate",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  UserController.deactivateUser,
);

// Super admin + partner admin: reactivate user
router.patch(
  "/:id/reactivate",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  UserController.reactivateUser,
);

export const UserRoutes = router;
