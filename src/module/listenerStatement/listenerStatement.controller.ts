import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ListenerStatementService } from "./listenerStatement.service";
import { StatusCodes } from "http-status-codes";

const getAllStatements = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
    userId: user?._id?.toString(),
    role: user?.role,
  };

  const result = await ListenerStatementService.getAllStatements(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Statements fetched successfully",
    data: result.statements,
    meta: result.meta,
  });
});

const getStatementById = catchAsync(async (req: Request, res: Response) => {
  const result = await ListenerStatementService.getStatementById(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Statement fetched successfully",
    data: result,
  });
});

const getKPIs = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    stationId: user?.stationId?.toString(),
    userId: user?._id?.toString(),
    role: user?.role,
  };

  const result = await ListenerStatementService.getKPIs(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "KPIs fetched successfully",
    data: result,
  });
});

export const ListenerStatementController = {
  getAllStatements,
  getStatementById,
  getKPIs,
};
