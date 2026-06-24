import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import AppError from "../../errors/AppError";
import { AuthRepository } from "./auth.repository";
import { UserRepository } from "../user/user.repository";
import { OtpRepository } from "../otp/otp.repository";
import { CountryRepository } from "../country/country.repository";
import createJwtToken from "../../jwt/createJwtToken";
import config from "../../config";
import { UserRole } from "shared/roles";
import { LoginProvider } from "./auth.interface";
import { OTPType } from "../otp/otp.interface";

// TODO: uncomment when SMS providers are configured
// import generateOTP from "../../util/generateOTP";
// import { sendAtOtp, isAfricasTalkingCountry } from "../../util/africasTalking";
// import { sendTwilioOtp } from "../../util/twilioOtp";

const OTP_EXPIRY_MINUTES = 30;
const OTP_MAX_ATTEMPTS = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const buildFullPhone = (phone: string, countryCode: string): string => {
  const clean = phone.replace(/^0+/, "");
  return `${countryCode}${clean}`;
};

const generateTokens = (userId: string, authId: string, role: string) => {
  const accessPayload = { userId, authId, role };
  const refreshPayload = { authId, type: "refresh" };

  const accessToken = createJwtToken(
    accessPayload,
    config.jwt.jwt_secret as string,
    config.jwt.jwt_expire_in as string,
  );

  const refreshToken = createJwtToken(
    refreshPayload,
    config.jwt.jwt_refresh_secret as string,
    config.jwt.jwt_refresh_expire_in as string,
  );

  return { accessToken, refreshToken };
};

const normalizeAuthResponse = (auth: any, user: any, tokens: any) => ({
  id: auth._id,
  phone: auth.phone,
  username: auth.username,
  role: auth.role,
  user: user
    ? {
        id: user._id,
        fullName: user.fullName,
        avatar: user.avatar,
        phone: user.phone,
        role: user.role,
        partnerId: user.partnerId,
        stationId: user.stationId,
        countryId: user.countryId,
        countryName: user.countryName,
        profileCompleted: user.profileCompleted,
        preferences: user.preferences,
      }
    : null,
  ...tokens,
});

// ─── App Flow: Initiate OTP ──────────────────────────────────────────────────

const initiate = async (data: { phone: string; countryCode: string; countryName: string }) => {
  const fullPhone = buildFullPhone(data.phone, data.countryCode);

  let auth = await AuthRepository.findByPhone(fullPhone);

  if (!auth) {
    auth = await AuthRepository.create({
      phone: fullPhone,
      countryCode: data.countryCode,
      loginProvider: LoginProvider.PHONE,
      role: UserRole.USER,
      isPhoneVerified: false,
      status: "active",
    });
  }
   //! stop for development time
  // const otp = generateOTP({ length: 4 });
  const otp= "1234";
  await OtpRepository.create({
    userId: auth._id,
    otp,
    type: "account_verification",
    provider: "phone",
    target: fullPhone,
    expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    isUsed: false,
  });
  //! stop for develop time
  // if (isAfricasTalkingCountry(data.countryName)) {
  //   await sendAtOtp(fullPhone, otp);
  // } else {
  //   await sendTwilioOtp(fullPhone, otp);
  // }

  return { message: "OTP sent", phone: fullPhone };
};

// ─── App Flow: Verify OTP ────────────────────────────────────────────────────

const verifyOtp = async (data: { phone: string; countryCode: string; otp: string; countryName?: string }) => {
  const fullPhone = buildFullPhone(data.phone, data.countryCode);

  const auth = await AuthRepository.findByPhone(fullPhone);
  if (!auth) {
    throw new AppError(StatusCodes.NOT_FOUND, "Account not found. Please initiate first.");
  }

  const otpRecord = await OtpRepository.findLatestUnused(auth._id.toString(), "account_verification" as OTPType);
  if (!otpRecord) {
    throw new AppError(StatusCodes.BAD_REQUEST, "No active OTP found. Please request a new one.");
  }

  if (otpRecord.isUsed) {
    throw new AppError(StatusCodes.BAD_REQUEST, "OTP already used. Request a new one.");
  }

  if (new Date() > otpRecord.expiresAt) {
    throw new AppError(StatusCodes.BAD_REQUEST, "OTP expired. Request a new one.");
  }

  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    throw new AppError(StatusCodes.TOO_MANY_REQUESTS, "Too many attempts. Request a new OTP.");
  }

  if (otpRecord.otp !== data.otp) {
    await OtpRepository.incrementAttempts(otpRecord._id.toString());
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid OTP.");
  }

  await OtpRepository.markUsed(otpRecord._id.toString());

  await AuthRepository.updateById(auth._id.toString(), {
    isPhoneVerified: true,
    lastLogin: new Date(),
  });

  // Look up country by name if provided
  let countryId: any = undefined;
  let countryName: string | undefined = undefined;
  if (data.countryName) {
    const country = await CountryRepository.findByName(data.countryName);
    if (country) {
      countryId = country._id;
      countryName = country.name;
    }
  }

  let user = await UserRepository.findByAuthId(auth._id.toString());
  if (!user) {
    user = await UserRepository.create({
      auth: auth._id,
      phone: fullPhone,
      phoneCountryCode: data.countryCode,
      countryName,
      countryId,
      role: UserRole.USER,
      profileCompleted: false,
      isBlocked: false,
      isDeleted: false,
      preferences: { theme: "default", language: "english" },
    });
  } else if (countryId && !user.countryId) {
    // Update countryId if not already set (for existing users)
    user = await UserRepository.updateById(user._id.toString(), { countryId, countryName });
  }

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User profile not found");
  }

  const tokens = generateTokens(user._id.toString(), auth._id.toString(), auth.role);

  return normalizeAuthResponse(auth, user, tokens);
};

// ─── Dashboard Flow: Username + Password Login ───────────────────────────────

const login = async (data: { username: string; password: string }) => {
  const auth = await AuthRepository.findByUsername(data.username);
  if (!auth) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials.");
  }

  if (auth.loginProvider !== LoginProvider.USERNAME) {
    throw new AppError(StatusCodes.BAD_REQUEST, "This account uses phone login.");
  }

  if (!auth.password) {
    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Account misconfigured.");
  }

  const isPasswordValid = await bcrypt.compare(data.password, auth.password);
  if (!isPasswordValid) {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials.");
  }

  if (auth.status !== "active") {
    throw new AppError(StatusCodes.FORBIDDEN, `Account is ${auth.status}.`);
  }

  await AuthRepository.updateById(auth._id.toString(), { lastLogin: new Date() });

  const user = await UserRepository.findByAuthId(auth._id.toString());
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User profile not found.");
  }

  const tokens = generateTokens(user._id.toString(), auth._id.toString(), auth.role);

  return normalizeAuthResponse(auth, user, tokens);
};

// ─── Refresh Token ───────────────────────────────────────────────────────────

const refresh = async (refreshToken: string) => {
  let payload: any;
  try {
    const jwt = await import("jsonwebtoken");
    payload = jwt.verify(refreshToken, config.jwt.jwt_refresh_secret as string);
  } catch {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid or expired refresh token.");
  }

  if (payload.type !== "refresh") {
    throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid token type.");
  }

  const auth = await AuthRepository.findById(payload.authId);
  if (!auth) {
    throw new AppError(StatusCodes.NOT_FOUND, "Account not found.");
  }

  if (auth.status !== "active") {
    throw new AppError(StatusCodes.FORBIDDEN, `Account is ${auth.status}.`);
  }

  const user = await UserRepository.findByAuthId(auth._id.toString());
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User profile not found.");
  }

  const tokens = generateTokens(user._id.toString(), auth._id.toString(), auth.role);

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
};

export const AuthService = { initiate, verifyOtp, login, refresh };
