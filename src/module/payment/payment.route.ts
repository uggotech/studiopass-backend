import { Router } from "express";
import auth from "../../middlewares/auth";
import { PaymentController } from "./payment.controller";

const router = Router();

// Initiate Mobile Money Collection (C2B Push)
router.post("/initiate", auth(), PaymentController.initiatePayment);

// Webhook for PayLeo (True African) - MTN Uganda (receives XML)
router.post("/webhook/payleo", PaymentController.handlePayLeoWebhook);

// Webhook for Airtel OpenAPI - Airtel Uganda (receives JSON)
router.post("/webhook/airtel", PaymentController.handleAirtelWebhook);

export const PaymentRoutes = router;
