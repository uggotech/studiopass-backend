import { Router } from "express";
import validateRequest from "@middlewares/validateRequest";
import { authLimiter, strictLimiter } from "@middlewares/security";
import { AuthController } from "./auth.controller";
import { AuthDto } from "./auth.dto";

const router = Router();

/**
 * @route   POST /api/v1/auth/initiate
 * @desc    Create an account or send a login OTP depending on auth state
 * @access  Public
 */
router.post(
  "/initiate",
  authLimiter,
  validateRequest(AuthDto.initiateAuth),
  AuthController.initiateAuth,
);

/**
 * @route   POST /api/v1/auth/verify
 * @desc    Verify the OTP for either account creation or login and return tokens
 * @access  Public
 */
router.post(
  "/verify",
  authLimiter,
  validateRequest(AuthDto.verifyOtp),
  AuthController.verifyOtp,
);

/**
 * @route   POST /api/v1/auth/resend-otp
 * @desc    Resend an OTP (account_verification or login)
 * @access  Public
 */
router.post(
  "/resend-otp",
  strictLimiter,
  validateRequest(AuthDto.resendOtp),
  AuthController.resendOtp,
);

/**
 * @route   POST /api/v1/auth/refresh-access-token
 * @desc    Issue a new access token from a valid refresh token
 * @access  Public
 */
router.post(
  "/refresh-access-token",
  authLimiter,
  validateRequest(AuthDto.refreshAccessToken),
  AuthController.refreshAccessToken,
);

export default router;

