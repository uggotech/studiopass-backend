import { Router } from "express";
import auth from "../../middlewares/auth";
import { UserRole } from "../../shared/roles";
import { DisbursementController } from "./disbursement.controller";

const router = Router();

router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  DisbursementController.getDisbursements,
);

export const DisbursementRoutes = router;
