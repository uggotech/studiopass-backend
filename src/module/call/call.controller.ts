import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { CallService } from "./call.service";
import { StationRepository } from "../station/station.repository";

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
  const { callId, webrtcDuration } = req.body;

  const result = await CallService.endCall(callId, userId, webrtcDuration);

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

const rejectCall = catchAsync(async (req, res) => {
  const operatorId = req.user!._id.toString();
  const { callId, reason } = req.body;

  const result = await CallService.rejectCall(callId, operatorId, reason);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Call cut. Listener credit refunded.",
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
  const user = req.user!;

  // Station-scope authorization: non-super_admin can only see their own station's calls
  if (user.role !== "super_admin") {
    if (user.role === "partner_admin") {
      // Partner admins can only view calls from stations under their partner
      const partnerId = (user as any).partnerId?.toString();
      if (!partnerId) {
        return sendResponse(res, {
          success: false,
          statusCode: StatusCodes.FORBIDDEN,
          message: "Partner admin has no partner assigned.",
        });
      }
      const station = await StationRepository.findById(stationId as string);
      if (!station || station.partner?.toString() !== partnerId) {
        return sendResponse(res, {
          success: false,
          statusCode: StatusCodes.FORBIDDEN,
          message: "You can only view calls from stations under your partner.",
        });
      }
    } else {
      const userStationId = (user as any).stationId?.toString();
      if (!userStationId || userStationId !== stationId) {
        return sendResponse(res, {
          success: false,
          statusCode: StatusCodes.FORBIDDEN,
          message: "You can only view calls from your own station.",
        });
      }
    }
  }

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
  rejectCall,
  getHistory,
  getStationCalls,
};
