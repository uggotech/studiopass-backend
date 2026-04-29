// Staff authentication middleware — removed (non-StudioPass code).
// Kept as a stub to avoid breaking any residual imports.

import { NextFunction, Request, Response } from "express";
import AppError from "../errors/AppError";
import { StatusCodes } from "http-status-codes";

const authStaff = () => (_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(StatusCodes.NOT_IMPLEMENTED, "Staff auth is not available"));
};

export default authStaff;
