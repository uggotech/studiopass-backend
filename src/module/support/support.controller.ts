import { Request, Response } from "express";
import StatusCodes from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { SupportService } from "./support.service";

export const SupportController = {
  createConversation: catchAsync(async (req: Request, res: Response) => {
    const userId = (req.user as any)._id.toString();
    const { message } = req.body;
    const result = await SupportService.createConversation(userId, message);

    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: "Support conversation initialized successfully",
      data: result,
    });
  }),

  getActiveUserConversation: catchAsync(async (req: Request, res: Response) => {
    const userId = (req.user as any)._id.toString();
    const result = await SupportService.getActiveUserConversation(userId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Active support conversation retrieved successfully",
      data: result,
    });
  }),

  getUnassignedQueue: catchAsync(async (req: Request, res: Response) => {
    const agent = req.user as any;
    const result = await SupportService.getUnassignedQueue(req.query as any, agent);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Unassigned support ticket queue retrieved successfully",
      meta: result.meta,
      data: result.data,
    });
  }),

  getMyClaimedTickets: catchAsync(async (req: Request, res: Response) => {
    const agentId = (req.user as any)._id.toString();
    const result = await SupportService.getMyClaimedTickets(req.query as any, agentId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Claimed tickets retrieved successfully",
      meta: result.meta,
      data: result.data,
    });
  }),

  getClosedTickets: catchAsync(async (req: Request, res: Response) => {
    const agent = req.user as any;
    const result = await SupportService.getClosedTickets(req.query as any, agent);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Closed tickets retrieved successfully",
      meta: result.meta,
      data: result.data,
    });
  }),

  getConversationMessages: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 100;
    const result = await SupportService.getConversationMessages(id, page, limit);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Conversation messages retrieved successfully",
      data: result,
    });
  }),

  claimTicket: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const agentId = (req.user as any)._id.toString();
    const result = await SupportService.claimTicket(id, agentId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Support ticket claimed successfully",
      data: result,
    });
  }),

  closeTicket: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userId = (req.user as any)._id.toString();
    const result = await SupportService.closeTicket(id, userId);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Support ticket closed successfully",
      data: result,
    });
  }),

  sendMessage: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const sender = req.user as any;
    const { message, attachments: bodyAttachments } = req.body;

    let attachments: string[] = Array.isArray(bodyAttachments) ? [...bodyAttachments] : [];
    if (req.body.image) {
      attachments.push(req.body.image);
    }

    const messageText = (message || "").trim() || (attachments.length > 0 ? "Attachment" : "");

    const result = await SupportService.sendMessage(id, sender, messageText, attachments);

    sendResponse(res, {
      statusCode: StatusCodes.CREATED,
      success: true,
      message: "Support message sent successfully",
      data: result,
    });
  }),

  searchEntities: catchAsync(async (req: Request, res: Response) => {
    const queryStr = (req.query.query as string) || "";
    const agent = req.user as any;
    const result = await SupportService.searchEntities(queryStr, agent);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Support entity search completed successfully",
      data: result,
    });
  }),

  getSupportStats: catchAsync(async (req: Request, res: Response) => {
    const agent = req.user as any;
    const result = await SupportService.getSupportStats(agent);

    sendResponse(res, {
      statusCode: StatusCodes.OK,
      success: true,
      message: "Support stats retrieved successfully",
      data: result,
    });
  }),
};
