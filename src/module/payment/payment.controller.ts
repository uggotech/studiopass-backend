import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { logger } from "../../logger/logger";
import { PaymentService } from "./payment.service";

const initiatePayment = catchAsync(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).user?._id;
  logger.info(`[PaymentController.initiatePayment] Incoming request:
  • Remote IP: ${req.ip}
  • User ID: ${userId}
  • User Agent: ${req.headers["user-agent"] || "unknown"}
  • Request Body: ${JSON.stringify(req.body)}`);

  const result = await PaymentService.initiatePayment(String(userId), req.body);
  logger.info(`[PaymentController.initiatePayment] Successfully initiated payment for user ${userId}. txId: ${result.transactionId}`);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const handlePayLeoWebhook = async (req: Request, res: Response) => {
  logger.info(`[PaymentController.handlePayLeoWebhook] >>> Inbound PayLeo Callback Received <<<
  • Remote IP: ${req.ip}
  • Content-Type: ${req.headers["content-type"]}
  • User Agent: ${req.headers["user-agent"]}
  • Query Params: ${JSON.stringify(req.query)}`);

  // Support raw string body, text body, or rawBody buffer
  let xmlBody = "";
  if (typeof req.body === "string") {
    xmlBody = req.body;
  } else if ((req as any).rawBody) {
    xmlBody = (req as any).rawBody;
  } else if (req.body && typeof req.body === "object") {
    // If sent as form field (xml / data / payload / request)
    xmlBody = req.body.xml || req.body.data || req.body.payload || req.body.request || "";
  }

  logger.info(`[PaymentController.handlePayLeoWebhook] Extracted XML payload (${xmlBody?.length || 0} bytes)`);

  const xmlResponse = await PaymentService.handlePayLeoWebhook(xmlBody);

  logger.info(`[PaymentController.handlePayLeoWebhook] Sending HTTP 200 response to True African`);
  res.status(StatusCodes.OK)
    .setHeader("Content-Type", "application/xml; charset=UTF-8")
    .send(xmlResponse);
};

const handleAirtelWebhook = async (req: Request, res: Response) => {
  logger.info(`[PaymentController.handleAirtelWebhook] >>> Inbound Airtel Callback Received <<<
  • Remote IP: ${req.ip}
  • Content-Type: ${req.headers["content-type"]}
  • Payload: ${JSON.stringify(req.body, null, 2)}`);

  const result = await PaymentService.handleAirtelWebhook(req.body);
  res.status(StatusCodes.OK).json(result);
};

export const PaymentController = {
  initiatePayment,
  handlePayLeoWebhook,
  handleAirtelWebhook,
};
