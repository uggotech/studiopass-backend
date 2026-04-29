// Staff permission middleware — removed (non-StudioPass code).
// Kept as a stub to avoid breaking any residual imports.

import { NextFunction, Request, Response } from "express";
import AppError from "../errors/AppError";
import { StatusCodes } from "http-status-codes";

const requirePermission = (_permission: string) => {
  return (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(StatusCodes.NOT_IMPLEMENTED, "Staff permissions are not available"));
  };
};

export default requirePermission;
