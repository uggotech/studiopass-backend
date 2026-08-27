import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Secret } from "jsonwebtoken";
import config from "../config";
import AppError from "../errors/AppError";
import { UserRepository } from "module/user/user.repository";
import { AuthRepository } from "module/auth/auth.repository";
import verifyJwtToken from "jwt/verifyJwtToken";
import { UserRole } from "shared/roles";
import { UserCache } from "module/user/user.cacheManage";

const auth =
  (...roles: UserRole[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tokenWithBearer = req.headers.authorization;

      if (!tokenWithBearer?.startsWith("Bearer ")) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const token = tokenWithBearer.split(" ")[1];
      if (!token) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const verifyUser = verifyJwtToken(token, config.jwt.jwt_secret as Secret);

      // Try cache first, then fallback to DB
      let user = await UserCache.getProfile(verifyUser.userId);
      if (!user) {
        user = await UserRepository.findById(verifyUser.userId);
        if (user) {
          UserCache.setProfile(verifyUser.userId, user);
        }
      }

      if (!user) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      if (user.isDeleted) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Your account has been deleted");
      }

      if (user.isBlocked) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Your account has been blocked");
      }

      // Check auth account status (active/inactive/suspended)
      const authId = user.auth ? (user.auth._id?.toString() || user.auth.toString()) : "";
      const authAccount = await AuthRepository.findById(authId);
      if (!authAccount || authAccount.status !== "active") {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Your account is deactivated");
      }

      // Normalize IDs so role scoping and filters work identically from cache or DB
      if (user._id) user._id = user._id.toString();
      if (user.stationId) {
        user.stationId = typeof user.stationId === "object" && "_id" in user.stationId
          ? (user.stationId as any)._id.toString()
          : user.stationId.toString();
      }
      if (user.partnerId) {
        user.partnerId = typeof user.partnerId === "object" && "_id" in user.partnerId
          ? (user.partnerId as any)._id.toString()
          : user.partnerId.toString();
      }

      req.user = user;

      const effectiveRole = user.role || UserRole.USER;

      if (roles.length && !roles.includes(effectiveRole as UserRole)) {
        throw new AppError(StatusCodes.FORBIDDEN, "You don't have permission to access this api");
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default auth;
