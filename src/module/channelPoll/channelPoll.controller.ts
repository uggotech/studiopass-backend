import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ChannelPollService } from "./channelPoll.service";
import AppError from "../../errors/AppError";

const createPoll = catchAsync(async (req, res) => {
  const createdBy = req.user!._id.toString();
  let stationId = req.body.station || req.body.stationId || req.user!.stationId?.toString();

  if (!stationId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
  }

  const result = await ChannelPollService.createPoll(stationId, req.body, createdBy, req.user?.role);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Poll created successfully",
    data: result,
  });
});

const getStationPolls = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const stationId = (req.params as any).stationId || (req.query as any).station || req.user!.stationId?.toString();

  if (!stationId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required.");
  }

  const result = await ChannelPollService.getStationPolls(
    stationId,
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

  const result = await ChannelPollService.getAllPolls(req.query as Record<string, unknown>, scope);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.polls,
    meta: result.meta,
  });
});

const getPollById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user?._id?.toString();
  const result = await ChannelPollService.getPollById(id, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const votePoll = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const { categoryIndex, nomineeIndex } = req.body;
  const userId = req.user!._id.toString();

  const result = await ChannelPollService.votePoll(id, categoryIndex, nomineeIndex, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Vote recorded successfully",
    data: result,
  });
});

const getPollResults = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user?._id?.toString();

  const result = await ChannelPollService.getPollResults(id, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const updatePoll = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await ChannelPollService.updatePoll(id, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Poll updated successfully",
    data: result,
  });
});

const deletePoll = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  await ChannelPollService.deletePoll(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Poll deleted successfully",
  });
});

export const ChannelPollController = {
  createPoll,
  getStationPolls,
  getAllPolls,
  getPollById,
  votePoll,
  getPollResults,
  updatePoll,
  deletePoll,
};
