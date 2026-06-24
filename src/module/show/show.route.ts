import { Router } from "express";
import { ShowController } from "./show.controller";
import auth from "../../middlewares/auth";
import { UserRole } from "shared/roles";

const router = Router();

// Dashboard users: list shows for a station
router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  ShowController.getShowsByStation,
);

export const ShowRoutes = router;
