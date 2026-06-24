import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Secret } from "jsonwebtoken";
import config from "../config";
import AppError from "../errors/AppError";
import { UserRepository } from "module/user/user.repository";
import { AuthRepository } from "module/auth/auth.repository";
import verifyJwtToken from "jwt/verifyJwtToken";
import { UserRole } from "shared/roles";

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

      const user = await UserRepository.findById(verifyUser.userId);
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
      const authAccount = await AuthRepository.findById(user.auth.toString());
      if (!authAccount || authAccount.status !== "active") {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Your account is deactivated");
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
