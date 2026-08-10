import { Router } from "express";
import { ShowController } from "./show.controller";
import auth from "../../middlewares/auth";
import { UserRole } from "shared/roles";
import validateRequest from "../../middlewares/validateRequest";
import { ShowDto } from "./show.dto";

const router = Router();

// Presenter: get my assigned shows
router.get(
  "/my-shows",
  auth(UserRole.PRESENTER),
  ShowController.getMyShows,
);

// Dashboard users: list shows (role-scoped via controller)
router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION),
  ShowController.getAllShows,
);

// Dashboard users: create a show
router.post(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(ShowDto.createShow),
  ShowController.createShow,
);

// Public: get active show for a station (listeners need this)
router.get(
  "/active/:stationId",
  ShowController.getActiveShow,
);

// Dashboard users: get single show by ID
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION),
  ShowController.getShowById,
);

// Dashboard users: update show
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(ShowDto.updateShow),
  ShowController.updateShow,
);

export const ShowRoutes = router;
