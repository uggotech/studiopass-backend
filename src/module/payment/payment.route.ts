import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { paymentInitiateLimiter } from "../../middlewares/security";
import { UserRole } from "../../shared/roles";
import { PaymentController } from "./payment.controller";
import { PaymentAdminController } from "./payment.admin.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

// Active credit packages offered for purchase (prices and credits are server-defined)
router.get("/packages", auth(), PaymentController.getPackages);

// Initiate Mobile Money Collection (C2B Push)
router.post(
  "/initiate",
  auth(),
  paymentInitiateLimiter,
  validateRequest(PaymentValidation.initiatePayment),
  PaymentController.initiatePayment,
);

// Webhook for PayLeo (True African) - MTN Uganda (receives XML; body parsed as text in app.ts)
router.post("/webhook/payleo", PaymentController.ipAllowlist("payleo"), PaymentController.handlePayLeoWebhook);

// Webhook for Airtel OpenAPI - Airtel Uganda (receives JSON)
router.post("/webhook/airtel", PaymentController.ipAllowlist("airtel"), PaymentController.handleAirtelWebhook);

// Plain reachability check (GET/HEAD): Airtel's portal may probe a callback URL when it is saved,
// and a 404 there can stop callbacks being sent. Returns nothing sensitive and changes no state.
router.get("/webhook/airtel", (_req, res) => {
  res.status(200).json({ ok: true });
});

// ── Super Admin: credit packages and prize payout limits ────────────────────
// (two path segments, so they never collide with GET /:transactionId below)
router.get("/admin/packages", auth(UserRole.SUPER_ADMIN), PaymentAdminController.listPackages);
router.post(
  "/admin/packages",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(PaymentValidation.createPackage),
  PaymentAdminController.createPackage,
);
router.patch(
  "/admin/packages/:id",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(PaymentValidation.updatePackage),
  PaymentAdminController.updatePackage,
);
router.get("/admin/payout-limits", auth(UserRole.SUPER_ADMIN), PaymentAdminController.getLimits);
router.patch(
  "/admin/payout-limits",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(PaymentValidation.updatePayoutLimits),
  PaymentAdminController.updateLimits,
);

// Status of one of the current user's payments (app polls this after initiate)
router.get(
  "/:transactionId",
  auth(),
  validateRequest(PaymentValidation.getPaymentStatus),
  PaymentController.getPaymentStatus,
);

export const PaymentRoutes = router;
