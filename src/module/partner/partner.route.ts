import { Router } from "express";
import { PartnerController } from "./partner.controller";
import { PartnerDto } from "./partner.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// Super admin: list all partners
router.get("/", auth(UserRole.SUPER_ADMIN), PartnerController.getAllPartners);

// Super admin: get single partner
router.get("/:id", auth(UserRole.SUPER_ADMIN), PartnerController.getPartnerById);

// Super admin: create partner + partner admin in one step
router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(PartnerDto.createPartnerWithAdmin),
  PartnerController.createPartnerWithAdmin,
);

// Super admin: update partner
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(PartnerDto.updatePartner),
  PartnerController.updatePartner,
);

// Super admin: deactivate partner
router.patch(
  "/:id/deactivate",
  auth(UserRole.SUPER_ADMIN),
  PartnerController.deactivatePartner,
);

// Super admin: reactivate partner
router.patch(
  "/:id/reactivate",
  auth(UserRole.SUPER_ADMIN),
  PartnerController.reactivatePartner,
);

export const PartnerRoutes = router;
