import { Router } from "express";
import { UserController } from "./user.controller";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserDto } from "./user.dto";
import processAndUpload from "../../middlewares/processAndUpload";

const router = Router();

// Get my profile (all authenticated roles)
router.get(
  "/profile",
  auth(
    UserRole.USER,
    UserRole.SUPER_ADMIN,
    UserRole.PARTNER_ADMIN,
    UserRole.STATION_ADMIN,
    UserRole.MEDIA_STATION,
    UserRole.PRESENTER,
    UserRole.CUSTOMER_CARE,
  ),
  UserController.getMyProfile,
);

// Update my profile (all authenticated roles, with optional avatar upload)
router.patch(
  "/profile",
  auth(
    UserRole.USER,
    UserRole.SUPER_ADMIN,
    UserRole.PARTNER_ADMIN,
    UserRole.STATION_ADMIN,
    UserRole.MEDIA_STATION,
    UserRole.PRESENTER,
    UserRole.CUSTOMER_CARE,
  ),
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

// App users: update FCM token
router.patch(
  "/profile/fcm-token",
  auth(UserRole.USER),
  validateRequest(UserDto.updateFcmToken),
  UserController.updateFcmToken,
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
  validateRequest(UserDto.createMediaStation),
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
  validateRequest(UserDto.createPresenter),
  UserController.createPresenter,
);

// Super admin: create customer care agent
router.post(
  "/create-customer-care",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(UserDto.createCustomerCare),
  UserController.createCustomerCareUser,
);

// Super admin + partner admin + station admin: list customer care users
router.get(
  "/customer-care",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.getAllCustomerCareUsers,
);

// Super admin + partner admin + station admin: list listeners (CRM)
router.get(
  "/listeners",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.getAllListeners,
);

// Super admin + partner admin + station admin + presenter: list top fans
router.get(
  "/top-fans",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.PRESENTER),
  UserController.getTopFans,
);

// Super admin + partner admin + station admin: get single listener (CRM)
router.get(
  "/listeners/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.getListenerById,
);

// Super admin + partner admin + station admin: get single listener poll votes
router.get(
  "/listeners/:id/votes",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.getListenerVotes,
);

// Super admin + partner admin: get single user
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  UserController.getUserById,
);

// Super admin + partner admin + station admin: update user
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  UserController.updateUserById,
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
