import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { AuditLogService } from "./auditLog.service";
import { StatusCodes } from "http-status-codes";

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const { action, authId, userId, page = "1", limit = "20" } = req.query;

  const result = await AuditLogService.getAuditLogs(
    {
      action: action as string,
      authId: authId as string,
      userId: userId as string,
    },
    Number(page),
    Number(limit),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Audit logs fetched successfully",
    data: result.logs,
    meta: result.meta,
  });
});

export const AuditLogController = {
  getAuditLogs,
};
