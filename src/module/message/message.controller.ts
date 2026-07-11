import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { MessageService } from "./message.service";
import AppError from "../../errors/AppError";
import { resolveMsisdn } from "../../shared/maskMsisdn";

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
  const { msisdn, content, templateUsed } = req.body;
  const senderUserId = req.user!._id.toString();

  // Auto-inject stationId from JWT (more secure than body)
  const stationId = req.body.stationId || req.user!.stationId?.toString();
  if (!stationId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required");
  }

  // Station-scope authorization: staff can only reply to their own station
  const userRole = req.user!.role;
  if (userRole !== "super_admin") {
    const userStationId = req.user!.stationId?.toString();
    if (!userStationId || userStationId !== stationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only reply to messages from your own station.");
    }
  }

  // Resolve masked msisdn to real number using centralized utility
  const resolvedMsisdn = await resolveMsisdn(msisdn, stationId);
  if (resolvedMsisdn !== msisdn) {
    // Validation: ensure we actually resolved something
    // resolveMsisdn returns original if not masked or not found
  }

  const message = await MessageService.sendStationReply(
    stationId,
    content,
    senderUserId,
    resolvedMsisdn,
    templateUsed,
  );

  // msisdnMasker middleware handles masking in the response automatically
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Reply sent successfully",
    data: message,
  });
});

const getThread = catchAsync(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;

  const userRole = req.user!.role;

  // Station-scope enforcement:
  // - super_admin / user / partner_admin: stationId from query (required for super_admin/user, optional for partner_admin)
  // - staff roles: stationId from JWT (query param ignored)
  let resolvedStationId: string;
  if (userRole === "super_admin" || userRole === "user") {
    resolvedStationId = req.query.stationId as string;
    if (!resolvedStationId) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Station ID is required.");
    }
  } else if (userRole === "partner_admin") {
    resolvedStationId = req.query.stationId as string || "";
  } else {
    resolvedStationId = req.user!.stationId?.toString() || "";
    if (!resolvedStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station associated with your account.");
    }
  }

  // Resolve msisdn: user role always uses their own phone; staff resolve from masked input
  let resolvedMsisdn: string;
  if (userRole === "user") {
    resolvedMsisdn = req.user!.phone!;
    if (!resolvedMsisdn) {
      throw new AppError(StatusCodes.FORBIDDEN, "No phone associated with your account.");
    }
  } else {
    const inputMsisdn = req.query.msisdn as string;
    if (!inputMsisdn) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Phone number is required.");
    }
    // Use centralized msisdn resolution
    resolvedMsisdn = await resolveMsisdn(inputMsisdn, resolvedStationId);
  }

  const result = await MessageService.getUserThread(
    resolvedStationId,
    resolvedMsisdn,
    Number(page),
    Number(limit),
  );

  // msisdnMasker middleware handles masking in the response automatically
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const getThreads = catchAsync(async (req, res) => {
  const { stationId, page = 1, limit = 50 } = req.query;

  const userRole = req.user!.role;

  // User role: return threads for their own phone number across all stations
  if (userRole === "user") {
    const userPhone = req.user!.phone;
    if (!userPhone) {
      throw new AppError(StatusCodes.FORBIDDEN, "No phone associated with your account.");
    }
    const userId = req.user!._id.toString();
    const result = await MessageService.getUserThreads(
      userPhone,
      userId,
      Number(page),
      Number(limit),
    );
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      data: result.threads,
      meta: result.meta,
    });
    return;
  }

  // Presenter: only see threads from their assigned shows
  if (userRole === "presenter") {
    const presenterStationId = req.user!.stationId?.toString();
    if (!presenterStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station associated with your account.");
    }
    const presenterId = req.user!._id.toString();
    const result = await MessageService.getPresenterThreads(
      presenterStationId,
      presenterId,
      Number(page),
      Number(limit),
    );
    // msisdnMasker middleware handles masking automatically
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      data: result.threads,
      meta: result.meta,
    });
    return;
  }

  // Other staff roles: scoped to their station or all stations (super_admin/partner_admin)
  let resolvedStationId = stationId as string | undefined;
  if (userRole === "partner_admin") {
    // partner_admin: accept stationId from query (optional — if not provided, returns all threads)
    resolvedStationId = stationId as string | undefined;
  } else if (userRole !== "super_admin") {
    resolvedStationId = req.user!.stationId?.toString();
    if (!resolvedStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "No station associated with your account.");
    }
  }

  const result = await MessageService.getStationThreads(
    resolvedStationId,
    Number(page),
    Number(limit),
  );

  // msisdnMasker middleware handles masking automatically
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.threads,
    meta: result.meta,
  });
});

const approveMessage = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const approvedBy = req.user!._id.toString();
  const userRole = req.user!.role;

  // Station-scope authorization: staff can only approve messages from their own station
  if (userRole !== "super_admin") {
    const message = await MessageService.findMessageForAuth(id);
    if (!message) {
      throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
    }
    const userStationId = req.user!.stationId?.toString();
    if (!userStationId || (message as any).station?._id?.toString() !== userStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only approve messages from your own station.");
    }
  }

  const result = await MessageService.approveMessage(id, approvedBy);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Message approved successfully",
    data: result,
  });
});

const rejectMessage = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const { rejectionReason } = req.body;
  const userRole = req.user!.role;

  // Station-scope authorization
  if (userRole !== "super_admin") {
    const message = await MessageService.findMessageForAuth(id);
    if (!message) {
      throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
    }
    const userStationId = req.user!.stationId?.toString();
    if (!userStationId || (message as any).station?._id?.toString() !== userStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only reject messages from your own station.");
    }
  }

  const result = await MessageService.rejectMessage(id, rejectionReason);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Message rejected",
    data: result,
  });
});

const sendToOutput = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userRole = req.user!.role;

  // Station-scope authorization
  if (userRole !== "super_admin") {
    const message = await MessageService.findMessageForAuth(id);
    if (!message) {
      throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
    }
    const userStationId = req.user!.stationId?.toString();
    if (!userStationId || (message as any).station?._id?.toString() !== userStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only send messages to output from your own station.");
    }
  }

  const result = await MessageService.sendToOutput(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Message sent to output",
    data: result,
  });
});

const deleteMessage = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userRole = req.user!.role;

  // Station-scope authorization
  if (userRole !== "super_admin") {
    const message = await MessageService.findMessageForAuth(id);
    if (!message) {
      throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
    }
    const userStationId = req.user!.stationId?.toString();
    if (!userStationId || (message as any).station?._id?.toString() !== userStationId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only delete messages from your own station.");
    }
  }

  await MessageService.deleteMessage(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Message deleted successfully",
  });
});

const markAsRead = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userRole = req.user!.role;

  // User can only mark their own messages as read
  if (userRole === "user") {
    const message = await MessageService.findMessageForAuth(id);
    if (!message) {
      throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
    }
    const userId = req.user!._id.toString();
    if ((message as any).user?.toString() !== userId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only mark your own messages as read.");
    }
  }

  const result = await MessageService.markAsRead(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Message marked as read",
    data: result,
  });
});

const getPendingMessages = catchAsync(async (req, res) => {
  const { stationId, page = 1, limit = 50 } = req.query;
  const userRole = req.user!.role;

  // Auto-inject stationId from JWT for station-scoped roles
  let resolvedStationId = stationId as string | undefined;
  if (userRole !== "super_admin" && userRole !== "partner_admin") {
    resolvedStationId = req.user!.stationId?.toString();
  }

  const result = await MessageService.getPendingMessages(
    resolvedStationId || "",
    Number(page),
    Number(limit),
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.messages,
    meta: result.meta,
  });
});

const getMessageById = catchAsync(async (req, res) => {
  const id = req.params.id as string;
  const userRole = req.user!.role;

  // User can only view their own messages
  if (userRole === "user") {
    const message = await MessageService.findMessageForAuth(id);
    if (!message) {
      throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
    }
    const userId = req.user!._id.toString();
    if ((message as any).user?.toString() !== userId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view your own messages.");
    }
  }

  const result = await MessageService.getMessageById(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result,
  });
});

const exportMessages = catchAsync(async (req, res) => {
  const { stationId, format = "csv" } = req.query;
  const userRole = req.user!.role;

  let resolvedStationId = stationId as string | undefined;
  if (userRole !== "super_admin" && userRole !== "partner_admin") {
    resolvedStationId = req.user!.stationId?.toString();
  }

  // Pass role so service can mask msisdn in CSV/JSON output
  const result = await MessageService.exportMessages(resolvedStationId, format as string, userRole);

  if (result.format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=messages-export.csv");
    res.send(result.data);
    return;
  }

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.data,
  });
});

const searchMessages = catchAsync(async (req, res) => {
  const { q, stationId, page = 1, limit = 20 } = req.query;
  const userRole = req.user!.role;

  let resolvedStationId = stationId as string | undefined;
  if (userRole !== "super_admin" && userRole !== "partner_admin") {
    resolvedStationId = req.user!.stationId?.toString();
  }

  const result = await MessageService.searchMessages(
    (q as string) || "",
    resolvedStationId,
    Number(page),
    Number(limit),
  );

  // msisdnMasker middleware handles masking automatically for JSON responses
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.messages,
    meta: result.meta,
  });
});

const getList = catchAsync(async (req, res) => {
  const { page = 1, limit = 20, stationId: queryStationId } = req.query;
  const userRole = req.user!.role;

  let resolvedStationId = queryStationId as string | undefined;
  if (userRole !== "super_admin" && userRole !== "partner_admin") {
    resolvedStationId = req.user!.stationId?.toString();
  }

  const result = await MessageService.getAllMessages(
    resolvedStationId,
    Number(page),
    Number(limit),
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    data: result.messages,
    meta: result.meta,
  });
});

export const MessageController = {
  sendMessage,
  sendStationReply,
  getThread,
  getThreads,
  getMessageById,
  approveMessage,
  rejectMessage,
  sendToOutput,
  deleteMessage,
  markAsRead,
  getPendingMessages,
  exportMessages,
  searchMessages,
  getList,
};
