import { Router } from "express";
import { StationController } from "./station.controller";
import { StationDto } from "./station.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import processAndUpload from "../../middlewares/processAndUpload";

const router = Router();

// App users (listeners): list active stations for their country
router.get("/public", auth(UserRole.USER), StationController.getPublicStations);

// Super admin + partner admin: list stations
router.get("/", auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN), StationController.getAllStations);

// Super admin + partner admin: get single station
router.get("/:id", auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN), StationController.getStationById);

// Super admin + partner admin: create station + station admin
router.post(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(StationDto.createStationWithAdmin),
  StationController.createStationWithAdmin,
);

// Super admin + partner admin: update station
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(StationDto.updateStation),
  StationController.updateStation,
);

// Super admin + partner admin: upload station logo
router.patch(
  "/:id/logo",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  processAndUpload,
  StationController.updateStation,
);

// Super admin + partner admin: upload station cover image
router.patch(
  "/:id/cover-image",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  processAndUpload,
  StationController.updateStation,
);

// Super admin + partner admin: deactivate station
router.patch(
  "/:id/deactivate",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  StationController.deactivateStation,
);

// Super admin + partner admin: reactivate station
router.patch(
  "/:id/reactivate",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  StationController.reactivateStation,
);

export const StationRoutes = router;
