import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { StationApiKeyService } from "./stationApiKey.service";
import { StatusCodes } from "http-status-codes";

// Dashboard routes (JWT auth)

const getKeys = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = req.query.stationId as string || user.stationId?.toString();

  if (!stationId) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "Station ID is required",
    });
    return;
  }

  const keys = await StationApiKeyService.getKeysByStation(
    stationId,
    user.role,
    user.stationId?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "API keys fetched successfully",
    data: keys,
  });
});

const createKey = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { stationId, name, type } = req.body;

  const result = await StationApiKeyService.createKey(
    stationId,
    name,
    type,
    user.role,
    user.stationId?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "API key created successfully. Save this key — it won't be shown again.",
    data: result,
  });
});

const regenerateKey = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const id = String(req.params.id);

  // Get stationId from key or from user
  const { StationApiKeyRepository } = await import("./stationApiKey.repository");
  const existingKey = await StationApiKeyRepository.findById(id);
  if (!existingKey) {
    sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: "API key not found",
    });
    return;
  }

  const result = await StationApiKeyService.regenerateKey(
    id,
    (existingKey as any).station?.toString(),
    user.role,
    user.stationId?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "API key regenerated. Save this key — it won't be shown again.",
    data: result,
  });
});

const deactivateKey = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const id = String(req.params.id);

  const { StationApiKeyRepository } = await import("./stationApiKey.repository");
  const existingKey = await StationApiKeyRepository.findById(id);
  if (!existingKey) {
    sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: "API key not found",
    });
    return;
  }

  await StationApiKeyService.deactivateKey(
    id,
    (existingKey as any).station?.toString(),
    user.role,
    user.stationId?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "API key deactivated",
  });
});

// External TV API (API key auth, not JWT)

const getMessages = catchAsync(async (req: Request, res: Response) => {
  const apiKey = (req.query.apiKey as string) || (req.headers["x-api-key"] as string);
  if (!apiKey) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "API key is required (pass as query param or x-api-key header)",
    });
    return;
  }
  const { limit, show, before } = req.query;
  const ipAddress = req.ip || req.socket.remoteAddress;

  const result = await StationApiKeyService.getMessagesForOutput(
    apiKey as string,
    {
      limit: limit ? Number(limit) : undefined,
      show: show as string,
      before: before as string,
    },
    ipAddress,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    data: result.messages,
  });
});

const getStats = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = req.query.stationId as string || user.stationId?.toString();

  if (!stationId) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "Station ID is required",
    });
    return;
  }

  const stats = await StationApiKeyService.getStationStats(
    stationId,
    user.role,
    user.stationId?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    data: stats,
  });
});

const getLogs = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const stationId = req.query.stationId as string || user.stationId?.toString();
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  if (!stationId) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "Station ID is required",
    });
    return;
  }

  const result = await StationApiKeyService.getStationLogs(
    stationId,
    page,
    limit,
    user.role,
    user.stationId?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    data: result.logs,
    meta: result.meta,
  });
});

const revealKey = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const id = String(req.params.id);
  const { password } = req.body;

  if (!password) {
    sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "Password is required to reveal API key",
    });
    return;
  }

  const result = await StationApiKeyService.revealKey(
    id,
    user.stationId?.toString() || "",
    password,
    user.role,
    user.stationId?.toString(),
    user.auth?.toString(),
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    data: result,
  });
});

export const StationApiKeyController = {
  getKeys,
  createKey,
  regenerateKey,
  deactivateKey,
  revealKey,
  getMessages,
  getStats,
  getLogs,
};
