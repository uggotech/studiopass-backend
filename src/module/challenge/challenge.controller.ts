import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ChallengeService } from "./challenge.service";
import AppError from "../../errors/AppError";

const createChallenge = catchAsync(async (req, res) => {
  const createdBy = req.user!._id.toString();
  const stationId = req.body.station || req.user!.stationId?.toString();

  if (!stationId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
  }

  const result = await ChallengeService.createChallenge(
    stationId,
    req.body,
    createdBy,
    req.user!.role,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Challenge created successfully",
    data: result,
  });
});

const getStationChallenges = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const userRole = req.user!.role;
  let stationId = req.user!.stationId?.toString();

  if (userRole !== "super_admin") {
    if (!stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station associated with your account.");
    }
  }

  const result = await ChallengeService.getStationChallenges(
    stationId!,
    Number(page),
    Number(limit),
    status as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.challenges,
    meta: result.meta,
  });
});

const getAllChallenges = catchAsync(async (req, res) => {
  const scope = {
    partnerId: req.user!.partnerId?.toString(),
    stationId: req.user!.stationId?.toString(),
    role: req.user!.role,
  };

  const result = await ChallengeService.getAllChallenges(req.query as Record<string, unknown>, scope);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.challenges,
    meta: result.meta,
  });
});

const getChallengeById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await ChallengeService.getChallengeById(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const participateInChallenge = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const { answers, timeTaken } = req.body;
  const userId = req.user!._id.toString();

  const result = await ChallengeService.participateInChallenge(id, userId, answers, timeTaken || 0);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Participation recorded successfully",
    data: result,
  });
});

const getChallengeResult = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userId = req.user!._id.toString();

  const result = await ChallengeService.getChallengeResult(id, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const updateChallenge = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await ChallengeService.updateChallenge(id, req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Challenge updated successfully",
    data: result,
  });
});

const deleteChallenge = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  await ChallengeService.deleteChallenge(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Challenge deleted successfully",
  });
});

const getAdminLeaderboard = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;

  const result = await ChallengeService.getAdminLeaderboard(id, page, limit);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const cancelChallenge = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const result = await ChallengeService.cancelChallenge(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Challenge cancelled successfully",
    data: result,
  });
});

export const ChallengeController = {
  createChallenge,
  getStationChallenges,
  getAllChallenges,
  getChallengeById,
  participateInChallenge,
  getChallengeResult,
  getAdminLeaderboard,
  updateChallenge,
  cancelChallenge,
  deleteChallenge,
};
