import { Router } from "express";
import { AuthController } from "./auth.controller";
import { AuthDto } from "./auth.dto";
import validateRequest from "../../middlewares/validateRequest";
import { authLimiter } from "../../middlewares/security";
import auth from "../../middlewares/auth";

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

// Dashboard: 2FA Verification on Login
router.post(
  "/2fa/verify-login",
  authLimiter,
  validateRequest(AuthDto.verify2FALogin),
  AuthController.verify2FALogin,
);

// Dashboard: Enable 2FA with initial code check
router.post(
  "/2fa/setup-enable",
  authLimiter,
  validateRequest(AuthDto.setup2FAEnable),
  AuthController.setup2FAEnable,
);

// Dashboard: Skip 2FA setup during login
router.post(
  "/2fa/skip-setup",
  authLimiter,
  validateRequest(AuthDto.skip2FASetup),
  AuthController.skip2FASetup,
);

// Dashboard Settings: Initialize 2FA setup
router.post(
  "/2fa/setup-init",
  auth(),
  AuthController.init2FASetup,
);

// Dashboard Settings: Disable 2FA
router.post(
  "/2fa/disable",
  auth(),
  validateRequest(AuthDto.disable2FA),
  AuthController.disable2FA,
);

// Both: refresh access token
router.post(
  "/refresh",
  authLimiter,
  validateRequest(AuthDto.refresh),
  AuthController.refresh,
);

// All authenticated roles: change password
router.patch(
  "/change-password",
  auth(),
  validateRequest(AuthDto.changePassword),
  AuthController.changePassword,
);

export const AuthRoutes = router;
