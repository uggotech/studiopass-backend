import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { PollService } from "./poll.service";
import AppError from "../../errors/AppError";

const createPoll = catchAsync(async (req, res) => {
  const { stationId: bodyStationId, question, options, showId, expiresAt } = req.body;
  const createdBy = req.user!._id.toString();

  // Auto-assign station from auth token for station_admin / media_station
  let stationId = bodyStationId;
  if (!stationId) {
    stationId = req.user!.stationId?.toString();
    if (!stationId) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
    }
  }

  const result = await PollService.createPoll(stationId, question, options, createdBy, showId, expiresAt);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Poll created successfully",
    data: result,
  });
});

const getStationPolls = catchAsync(async (req, res) => {
  const { stationId, page = 1, limit = 20, status } = req.query;

  const userRole = req.user!.role;
  let resolvedStationId = stationId as string | undefined;

  if (userRole !== "super_admin") {
    resolvedStationId = req.user!.stationId?.toString();
    if (!resolvedStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station associated with your account.");
    }
  }

  const result = await PollService.getStationPolls(
    resolvedStationId!,
    Number(page),
    Number(limit),
    status as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.polls,
    meta: result.meta,
  });
});

const getAllPolls = catchAsync(async (req, res) => {
  const scope = {
    partnerId: req.user!.partnerId?.toString(),
    stationId: req.user!.stationId?.toString(),
    role: req.user!.role,
  };

  const result = await PollService.getAllPolls(req.query as Record<string, unknown>, scope);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.polls,
    meta: result.meta,
  });
});

const getPollById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await PollService.getPollById(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const votePoll = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const { optionIndex } = req.body;
  const userId = req.user!._id.toString();

  const result = await PollService.votePoll(id, optionIndex, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Vote recorded successfully",
    data: result,
  });
});

const updatePoll = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const { question, status } = req.body;

  const result = await PollService.updatePoll(id, { question, status });

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Poll updated successfully",
    data: result,
  });
});

const deletePoll = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  await PollService.deletePoll(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Poll deleted successfully",
  });
});

export const PollController = {
  createPoll,
  getStationPolls,
  getAllPolls,
  getPollById,
  votePoll,
  updatePoll,
  deletePoll,
};
