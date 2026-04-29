import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import config from "config";
import AppError from "errors/AppError";
import { createJwtToken, verifyJwtToken } from "jwt";
import { OTPService } from "module/otp/otp.service";
import { checkProfileComplete } from "module/user/user.interface";
import { UserRepository } from "module/user/user.repository";
import { LoginProvider, UserRole } from "./auth.interface";
import { AuthRepository } from "./auth.repository";
import { buildTokenPayload } from "./auth.util";

// ─── Payload Types ────────────────────────────────────────────────────────────

type TInitiateAuthPayload = {
  phone: string;
  countryCode: string;
  countryName: string;
};

type TVerifyOtpPayload = {
  phone: string;
  countryCode: string;
  otp: string;
};

type TResendOtpPayload = {
  phone: string;
  countryCode: string;
};

type TRefreshAccessTokenPayload = {
  refreshToken: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildSessionTokens = (
  authDoc: {
    _id: Types.ObjectId;
    phone?: string;
    role: UserRole;
    loginProvider: LoginProvider;
  },
  userId: Types.ObjectId,
) => {
  const tokenPayload = buildTokenPayload(authDoc, userId);
  return {
    accessToken: createJwtToken(
      tokenPayload,
      config.jwt.jwt_secret as string,
      config.jwt.jwt_expire_in || "7d",
    ),
    refreshToken: createJwtToken(
      tokenPayload,
      (config.jwt.jwt_refresh_secret || config.jwt.jwt_secret) as string,
      config.jwt.jwt_refresh_expire_in || "30d",
    ),
  };
};

/** Compose E.164-ish phone string for storage/lookup (countryCode + phone). */
const buildFullPhone = (countryCode: string, phone: string) =>
  `${countryCode}${phone.replace(/^\+/, "")}`;

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Initiate Auth — unified entry point for registration and login.
 * Creates account data if nothing exists, and sends appropriate OTP based on state.
 */
const initiateAuth = async (payload: TInitiateAuthPayload) => {
  const fullPhone = buildFullPhone(payload.countryCode, payload.phone);

  let authDoc = await AuthRepository.findOne({ phone: fullPhone });
  let userDoc = authDoc ? await UserRepository.findOne({ auth: authDoc._id }) : null;

  let message: string;
  let otpType: "account_verification" | "login";

  if (!authDoc) {
    // Brand new account creation
    authDoc = await AuthRepository.create({
      phone: fullPhone,
      countryCode: payload.countryCode,
      loginProvider: LoginProvider.PHONE,
      isPhoneVerified: false,
    });

    userDoc = await UserRepository.create({
      auth: authDoc._id as Types.ObjectId,
      phone: fullPhone,
      phoneCountryCode: payload.countryCode,
      countryName: payload.countryName,
      profileCompleted: false,
      role: authDoc.role,
    });

    message = "Account created. Please verify your phone number with the OTP sent.";
    otpType = "account_verification";
  } else if (!authDoc.isPhoneVerified) {
    // Existing unverified account — update info if needed and send verification OTP
    if (userDoc && userDoc.countryName !== payload.countryName) {
      await UserRepository.updateById(String(userDoc._id), {
        countryName: payload.countryName,
      });
    }
    message = "Account verification OTP sent to your phone number.";
    otpType = "account_verification";
  } else {
    // Existing verified account — login flow
    if (authDoc.status !== "active") {
      throw new AppError(StatusCodes.UNAUTHORIZED, "Your account is suspended or inactive.");
    }
    message = "Login OTP sent to your phone number.";
    otpType = "login";
  }

  const countryName = userDoc?.countryName || payload.countryName;

  await OTPService.createOTP({
    userId: authDoc._id as Types.ObjectId,
    type: otpType,
    provider: "phone",
    target: fullPhone,
    countryName,
  });

  return {
    message,
    data: { phone: fullPhone },
  };
};

/**
 * Verify OTP — unified verification for both account creation and login.
 */
const verifyOtp = async (payload: TVerifyOtpPayload) => {
  const fullPhone = buildFullPhone(payload.countryCode, payload.phone);

  const authDoc = await AuthRepository.findOne({ phone: fullPhone });
  if (!authDoc) {
    throw new AppError(StatusCodes.NOT_FOUND, "Account not found");
  }

  const otpType = authDoc.isPhoneVerified ? "login" : "account_verification";

  await OTPService.verifyOTP(authDoc._id as Types.ObjectId, otpType, payload.otp);

  const updateData: any = { lastLogin: new Date() };
  if (!authDoc.isPhoneVerified) {
    updateData.isPhoneVerified = true;
  }

  const updatedAuth = await AuthRepository.updateById(String(authDoc._id), updateData);
  if (!updatedAuth) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update account status");
  }

  const userDoc = await UserRepository.findOne({ auth: authDoc._id });
  if (!userDoc) {
    throw new AppError(StatusCodes.NOT_FOUND, "User profile not found");
  }

  const isCompleteProfile = checkProfileComplete(userDoc);
  const tokens = buildSessionTokens(
    { ...updatedAuth.toObject(), _id: updatedAuth._id as Types.ObjectId },
    userDoc._id,
  );

  return {
    message: authDoc.isPhoneVerified ? "Login successful" : "Phone verified successfully",
    data: {
      ...tokens,
      user: {
        ...userDoc.toObject(),
        role: userDoc.role || authDoc.role,
      },
      isCompleteProfile,
    },
  };
};

/**
 * Resend OTP — state-aware OTP resending.
 */
const resendOtp = async (payload: TResendOtpPayload) => {
  const fullPhone = buildFullPhone(payload.countryCode, payload.phone);

  const authDoc = await AuthRepository.findOne({ phone: fullPhone });
  if (!authDoc) {
    throw new AppError(StatusCodes.NOT_FOUND, "Account not found");
  }

  const otpType = authDoc.isPhoneVerified ? "login" : "account_verification";

  const userDoc = await UserRepository.findOne({ auth: authDoc._id }).lean();
  const countryName = userDoc?.countryName || "Unknown";

  await OTPService.createOTP({
    userId: authDoc._id as Types.ObjectId,
    type: otpType,
    provider: "phone",
    target: fullPhone,
    countryName,
  });

  return {
    message: "OTP resent successfully",
    data: { phone: fullPhone },
  };
};

/**
 * Refresh Access Token — issue a new access token from a valid refresh token.
 */
const refreshAccessToken = async (payload: TRefreshAccessTokenPayload) => {
  let decoded: any;

  try {
    decoded = verifyJwtToken(
      payload.refreshToken,
      (config.jwt.jwt_refresh_secret || config.jwt.jwt_secret) as string,
    );
  } catch {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid or expired refresh token");
  }

  const authDoc = await AuthRepository.findOne({ _id: decoded.authId });

  if (!authDoc) {
    throw new AppError(StatusCodes.NOT_FOUND, "Account not found");
  }

  if (authDoc.status !== "active") {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Your account is not active");
  }

  const userDoc = await UserRepository.findOne({ auth: authDoc._id });

  if (!userDoc) {
    throw new AppError(StatusCodes.NOT_FOUND, "User profile not found");
  }

  const tokenPayload = buildTokenPayload(
    { ...authDoc.toObject(), _id: authDoc._id as Types.ObjectId },
    userDoc._id,
  );

  const newAccessToken = createJwtToken(
    tokenPayload,
    config.jwt.jwt_secret as string,
    config.jwt.jwt_expire_in || "7d",
  );

  return { data: { accessToken: newAccessToken } };
};

export const AuthService = {
  initiateAuth,
  verifyOtp,
  resendOtp,
  refreshAccessToken,
};


