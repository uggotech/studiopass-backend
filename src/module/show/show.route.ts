import { Router } from "express";
import { ShowController } from "./show.controller";
import auth from "../../middlewares/auth";
import { UserRole } from "shared/roles";

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
  ShowController.createShow,
);

// Dashboard users: get single show by ID
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION),
  ShowController.getShowById,
);

export const ShowRoutes = router;
