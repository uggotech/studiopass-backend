import { Router } from "express";
import { SettingsController } from "./settings.controller";
import { SettingsDto } from "./settings.dto";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "shared/roles";

const router = Router();

// Super Admin: get security settings
router.get(
  "/security",
  auth(UserRole.SUPER_ADMIN),
  SettingsController.getSecuritySettings,
);

// Super Admin: update security settings
router.patch(
  "/security",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(SettingsDto.updateSecuritySettings),
  SettingsController.updateSecuritySettings,
);

export const SettingsRoutes = router;
