import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { markPaidSchema } from "./disbursement.dto";
import { UserRole } from "../../shared/roles";
import { DisbursementController } from "./disbursement.controller";

const router = Router();

router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  DisbursementController.getDisbursements,
);

// Re-queue a failed automated prize payout (e.g. after topping up the payout wallet)
router.post(
  "/:id/retry",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  DisbursementController.retryDisbursement,
);

// Record a mobile money prize that accounts paid manually (e.g. MTN winners until MTN payouts exist)
router.post(
  "/:id/mark-paid",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(markPaidSchema),
  DisbursementController.markPaidManually,
);

// Delivery report webhook from Africa's Talking
router.post(
  "/webhook/africas-talking",
  DisbursementController.handleAfricasTalkingWebhook,
);

export const DisbursementRoutes = router;
