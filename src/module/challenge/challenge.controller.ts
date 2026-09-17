import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { ChallengeService } from "./challenge.service";
import { ChallengeRepository } from "./challenge.repository";
import { StationRepository } from "../station/station.repository";
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
    userId: req.user!._id.toString(),
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
  const result = await ChallengeService.getChallengeById(id, req.user!.role);

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

const getMyParticipations = catchAsync(async (req, res) => {
  const userId = req.user!._id.toString();
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const result = await ChallengeService.getMyParticipations(userId, page, limit);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.items,
    meta: result.meta,
  });
});

const updateChallenge = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  // Ownership check: ensure user can modify this challenge's station
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  if (req.user!.role !== "super_admin") {
    const station: any = await StationRepository.findById(challenge.station.toString());
    if (!station) throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
    if (req.user!.role === "partner_admin" && station.partner?.toString() !== req.user!.partnerId?.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to modify this challenge.");
    }
    if (["station_admin", "media_station", "presenter"].includes(req.user!.role) && challenge.station.toString() !== req.user!.stationId?.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to modify this challenge.");
    }
  }
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
  // Ownership check
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  if (req.user!.role !== "super_admin") {
    const station: any = await StationRepository.findById(challenge.station.toString());
    if (!station) throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
    if (req.user!.role === "partner_admin" && station.partner?.toString() !== req.user!.partnerId?.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to delete this challenge.");
    }
  }
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
  // Ownership check
  const challenge = await ChallengeRepository.findById(id);
  if (!challenge) throw new AppError(StatusCodes.NOT_FOUND, "Challenge not found");
  if (req.user!.role !== "super_admin") {
    const station: any = await StationRepository.findById(challenge.station.toString());
    if (!station) throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
    if (req.user!.role === "partner_admin" && station.partner?.toString() !== req.user!.partnerId?.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to cancel this challenge.");
    }
  }
  const result = await ChallengeService.cancelChallenge(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Challenge cancelled successfully",
    data: result,
  });
});

const getChallengeStats = catchAsync(async (req, res) => {
  const scope = {
    partnerId: req.user!.partnerId?.toString(),
    stationId: req.user!.stationId?.toString(),
    role: req.user!.role,
  };

  const result = await ChallengeService.getChallengeStats(scope);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
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
  getMyParticipations,
  getAdminLeaderboard,
  getChallengeStats,
  updateChallenge,
  cancelChallenge,
  deleteChallenge,
};
