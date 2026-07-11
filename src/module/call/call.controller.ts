import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { CallService } from "./call.service";

const requestCall = catchAsync(async (req, res) => {
  const userId = req.user!._id.toString();
  const { stationId } = req.body;

  const result = await CallService.requestCall(userId, stationId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Call request submitted",
    data: result,
  });
});

const acceptCall = catchAsync(async (req, res) => {
  const operatorId = req.user!._id.toString();
  const { callId } = req.body;

  const result = await CallService.acceptCall(callId, operatorId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Call accepted",
    data: result,
  });
});

const joinCall = catchAsync(async (req, res) => {
  const userId = req.user!._id.toString();
  const { callId } = req.body;

  const result = await CallService.joinCall(callId, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Joined call",
    data: result,
  });
});

const endCall = catchAsync(async (req, res) => {
  const userId = req.user!._id.toString();
  const { callId } = req.body;

  const result = await CallService.endCall(callId, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Call ended",
    data: result,
  });
});

const cancelCall = catchAsync(async (req, res) => {
  const userId = req.user!._id.toString();
  const { callId } = req.body;

  const result = await CallService.cancelCall(callId, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Call cancelled",
    data: result,
  });
});

const getHistory = catchAsync(async (req, res) => {
  const userId = req.user!._id.toString();
  const { page = 1, limit = 20 } = req.query;

  const result = await CallService.getCallHistory(userId, Number(page), Number(limit));

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.calls,
    meta: result.meta,
  });
});

const getStationCalls = catchAsync(async (req, res) => {
  const { stationId, status, page = 1, limit = 20 } = req.query;

  const result = await CallService.getStationCalls(
    stationId as string,
    Number(page),
    Number(limit),
    status as string | undefined,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.calls,
    meta: result.meta,
  });
});

export const CallController = {
  requestCall,
  acceptCall,
  joinCall,
  endCall,
  cancelCall,
  getHistory,
  getStationCalls,
};
