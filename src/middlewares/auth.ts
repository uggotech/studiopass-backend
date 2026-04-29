import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Secret } from "jsonwebtoken";
import config from "../config";

import AppError from "../errors/AppError";
import { verifyJwtToken } from "jwt";
import { UserRepository } from "module/user/user.repository";
import { logger } from "logger/logger";

const auth =
  (...roles: string[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const tokenWithBearer = req.headers.authorization;

      if (!tokenWithBearer) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      if (!tokenWithBearer.startsWith("Bearer ")) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      const token = tokenWithBearer.split(" ")[1];

      if (!token) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized");
      }

      // verify token — payload shape: { userId, authId, email, phone, role, loginProvider }
      const verifyUser = verifyJwtToken(
        token,
        config.jwt.jwt_secret as Secret,
      );

      const user = await UserRepository.findById(verifyUser.userId);
      logger.info(user)

      if (!user) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "You are not authorized",
        );
      }

      if (user.isDeleted) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "Your account has been deleted",
        );
      }

      if (user.isBlocked) {
        throw new AppError(
          StatusCodes.UNAUTHORIZED,
          "Your account has been blocked",
        );
      }

      // set user to header
      req.user = user;
      logger.info(`Authenticated user ${user._id} with role ${user.role}`);
      // role check from database (more reliable than token if role changed)
      const effectiveRole = user.role || "user";

      if (roles.length && !roles.includes(effectiveRole)) {
        throw new AppError(
          StatusCodes.FORBIDDEN,
          "You don't have permission to access this api",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default auth;
