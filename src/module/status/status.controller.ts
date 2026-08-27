import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { StatusService } from "./status.service";
import AppError from "../../errors/AppError";

const createStatus = catchAsync(async (req, res) => {
  const { content, media, mediaType, thumbnail, expiresAt } = req.body;
  const createdBy = req.user!._id.toString();
  const callerRole = req.user!.role;
  const userPartnerId = req.user!.partnerId?.toString();

  let stationId = req.body.stationId;
  if (!stationId) {
    stationId = req.user!.stationId?.toString();
    if (!stationId) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
    }
  }

  const result = await StatusService.createStatus({
    stationId,
    createdBy,
    content,
    media,
    mediaType,
    thumbnail,
    expiresAt,
    callerRole,
    userPartnerId,
  });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Status created successfully",
    data: result,
  });
});

const getStationStatuses = catchAsync(async (req, res) => {
  const stationId = req.params.stationId as string;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));

  const result = await StatusService.getStationStatuses(stationId, page, limit);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.statuses,
    meta: result.meta,
  });
});

const getAllStationStatuses = catchAsync(async (req, res) => {
  const stationId = req.params.stationId as string;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const callerRole = req.user!.role;
  const userPartnerId = req.user!.partnerId?.toString();

  const result = await StatusService.getAllStationStatuses(
    stationId,
    page,
    limit,
    { role: callerRole, partnerId: userPartnerId },
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.statuses,
    meta: result.meta,
  });
});

const getStatusById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await StatusService.getStatusById(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const deleteStatus = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const callerRole = req.user!.role;
  const userPartnerId = req.user!.partnerId?.toString();

  await StatusService.deleteStatus(id, callerRole, userPartnerId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Status deleted successfully",
  });
});

const generateWeeklyTopFans = catchAsync(async (req, res) => {
  const { stationId } = req.body;

  if (!stationId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
  }

  const result = await StatusService.generateManual(stationId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: { count: result.count },
  });
});

const getFeedByCountry = catchAsync(async (req, res) => {
  const countryId = req.query.countryId as string;

  if (!countryId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Country ID is required");
  }

  const userId = req.user?._id?.toString();
  const result = await StatusService.getFeedByCountry(countryId, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const recordView = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!._id.toString();

  const result = await StatusService.recordView(id, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const toggleLike = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!._id.toString();

  const result = await StatusService.toggleLike(id, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.isLiked ? "Status liked" : "Status unliked",
    data: result,
  });
});

export const StatusController = {
  createStatus,
  getStationStatuses,
  getAllStationStatuses,
  getStatusById,
  deleteStatus,
  generateWeeklyTopFans,
  getFeedByCountry,
  recordView,
  toggleLike,
};
