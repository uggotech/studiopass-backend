import { Router } from "express";
import { AuthController } from "./auth.controller";
import { AuthDto } from "./auth.dto";
import validateRequest from "../../middlewares/validateRequest";
import { authLimiter } from "../../middlewares/security";

const router = Router();

// App: send OTP to phone
router.post(
  "/initiate",
  authLimiter,
  validateRequest(AuthDto.initiate),
  AuthController.initiate,
);

// App: verify OTP and get tokens
router.post(
  "/verify-otp",
  authLimiter,
  validateRequest(AuthDto.verifyOtp),
  AuthController.verifyOtp,
);

// Dashboard: login with username + password
router.post(
  "/login",
  authLimiter,
  validateRequest(AuthDto.login),
  AuthController.login,
);

// Both: refresh access token
router.post(
  "/refresh",
  validateRequest(AuthDto.refresh),
  AuthController.refresh,
);

export const AuthRoutes = router;
