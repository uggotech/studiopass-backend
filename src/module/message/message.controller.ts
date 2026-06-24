import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { MessageService } from "./message.service";

const sendMessage = catchAsync(async (req, res) => {
  const { stationId, content, imageUrl } = req.body;
  const userId = req.user!._id.toString();

  const result = await MessageService.sendUserMessage(stationId, content, userId, imageUrl);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Message sent successfully",
    data: result,
  });
});

const sendStationReply = catchAsync(async (req, res) => {
  const { stationId, msisdn, content, templateUsed } = req.body;
  const senderUserId = req.user!._id.toString();

  const message = await MessageService.sendStationReply(
    stationId,
    content,
    senderUserId,
    msisdn,
    templateUsed,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Reply sent successfully",
    data: message,
  });
});

const getThread = catchAsync(async (req, res) => {
  const { stationId, msisdn, page = 1, limit = 50 } = req.query;

  const result = await MessageService.getUserThread(
    stationId as string,
    msisdn as string,
    Number(page),
    Number(limit),
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const getThreads = catchAsync(async (req, res) => {
  const { stationId, page = 1, limit = 50 } = req.query;

  const result = await MessageService.getStationThreads(
    stationId as string,
    Number(page),
    Number(limit),
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.threads,
    meta: result.meta,
  });
});

export const MessageController = {
  sendMessage,
  sendStationReply,
  getThread,
  getThreads,
};
