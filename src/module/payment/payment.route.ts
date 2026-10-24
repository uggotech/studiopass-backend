import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { paymentInitiateLimiter } from "../../middlewares/security";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

// Credit packages offered for purchase (prices and credits are server-defined)
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

// Status of one of the current user's payments (app polls this after initiate)
router.get(
  "/:transactionId",
  auth(),
  validateRequest(PaymentValidation.getPaymentStatus),
  PaymentController.getPaymentStatus,
);

export const PaymentRoutes = router;
