import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import config from "../../config";
import { logger } from "../../logger/logger";
import { PaymentService } from "./payment.service";
import {
  parsePayLeoXmlCallback,
  fromForwardedPayLeoCallback,
  verifyPayLeoForwardSignature,
  buildPayLeoXmlResponse,
} from "./payleo.service";
import { PayLeoCallbackParsed } from "./payment.interface";
import { getAirtelCallbackAuthMode, verifyAirtelCallbackHash } from "./airtel.signature";

const getUserId = (req: Request) => String((req as any).user?.id || (req as any).user?._id);

const getPackages = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit packages retrieved",
    data: PaymentService.getPackages(),
  });
});

const initiatePayment = catchAsync(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const result = await PaymentService.initiatePayment(userId, {
    packageId: req.body.packageId,
    phoneNumber: req.body.phoneNumber,
  });
  logger.info(`[PaymentController.initiatePayment] user=${userId} txId=${result.transactionId} provider=${result.provider}`);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const getPaymentStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.getPaymentStatus(getUserId(req), String(req.params.transactionId));
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Payment status retrieved",
    data: result,
  });
});

/**
 * Only allow webhook calls from the provider's IPs when an allowlist is configured.
 * With an empty allowlist the call is let through and a warning is logged, so testing
 * isn't blocked before the provider's IPs are known.
 */
const ipAllowlist = (provider: "payleo" | "airtel") => {
  const raw = provider === "payleo" ? config.payleo.callback_ips : config.airtel.callback_ips;
  const allowed = raw.split(",").map((ip) => ip.trim()).filter(Boolean);

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = String(req.ip || "").replace(/^::ffff:/, "");
    if (allowed.length === 0) {
      logger.warn(`[Webhook ${provider}] Callback from ${ip} accepted with NO IP allowlist configured`);
      return next();
    }
    if (allowed.includes(ip)) return next();

    logger.error(`[Webhook ${provider}] ⛔ Rejected callback from non-allowlisted IP ${ip}`);
    if (provider === "payleo") {
      return res
        .status(StatusCodes.FORBIDDEN)
        .setHeader("Content-Type", "application/xml; charset=UTF-8")
        .send(buildPayLeoXmlResponse(403, "Forbidden"));
    }
    return res.status(StatusCodes.FORBIDDEN).json({ status: "forbidden" });
  };
};

/**
 * PayLeo callbacks arrive as raw XML (parsed as text by the route-level parser),
 * possibly wrapped in a form field, or as JSON from the client's payleo_callback.php
 * forwarder (signed with X-StudioPass-Signature).
 */
const handlePayLeoWebhook = async (req: Request, res: Response) => {
  const body = typeof req.body === "string" ? req.body.replace(/^﻿/, "").trim() : "";
  logger.info(`[PaymentController.handlePayLeoWebhook] Callback from ${req.ip}, content-type="${req.headers["content-type"]}", ${body.length} bytes`);

  let parsed: PayLeoCallbackParsed | null = null;
  let httpStatus = 200;
  let xml = "";

  if (body.startsWith("{")) {
    // JSON from the client's forwarder: must carry a valid signature
    const signature = req.headers["x-studiopass-signature"] as string | undefined;
    if (!verifyPayLeoForwardSignature(body, signature)) {
      logger.error(`[PayLeo Webhook] ⛔ Forwarded JSON callback rejected: missing/invalid X-StudioPass-Signature`);
      httpStatus = 401;
      xml = buildPayLeoXmlResponse(401, "Invalid signature");
    } else {
      try {
        parsed = fromForwardedPayLeoCallback(JSON.parse(body));
      } catch {
        parsed = null;
      }
    }
  } else {
    let xmlBody = body;
    if (!xmlBody.startsWith("<") && body.includes("=")) {
      // XML posted as a form field (xml / data / payload / request)
      const form = new URLSearchParams(body);
      xmlBody = (form.get("xml") || form.get("data") || form.get("payload") || form.get("request") || "").trim();
    }
    parsed = parsePayLeoXmlCallback(xmlBody);
  }

  if (!xml) {
    try {
      ({ httpStatus, xml } = await PaymentService.handlePayLeoCallback(parsed));
    } catch (err) {
      logger.error("[PaymentController.handlePayLeoWebhook] Processing failed:", err);
      httpStatus = 500;
      xml = buildPayLeoXmlResponse(500, "Temporary error, please retry");
    }
  }

  res.status(httpStatus).setHeader("Content-Type", "application/xml; charset=UTF-8").send(xml);
};

const handleAirtelWebhook = async (req: Request, res: Response) => {
  logger.info(`[PaymentController.handleAirtelWebhook] Callback from ${req.ip}, content-type="${req.headers["content-type"]}"`);

  // Callback authentication: body.hash = Base64(HMAC-SHA256(body without hash, Hash Key)).
  // log mode: verify and log, never reject, still confirm "TS" with Airtel's enquiry.
  // enforce mode: reject missing/invalid hash and trust a valid one (no enquiry needed).
  const mode = getAirtelCallbackAuthMode();
  let trusted = false;
  if (mode !== "off") {
    const check = verifyAirtelCallbackHash((req as any).rawBody, req.body, config.airtel.callback_hash_key);
    if (check.valid) {
      logger.info(`[Airtel Webhook] Hash OK (scheme=${check.scheme}, mode=${mode})`);
    } else {
      logger.warn(
        `[Airtel Webhook] Hash ${check.present ? "INVALID" : "MISSING"} (mode=${mode}). ` +
          `Body keys=${JSON.stringify(Object.keys(req.body || {}))}, ` +
          `transaction keys=${JSON.stringify(Object.keys(req.body?.transaction || {}))}, ` +
          `header names=${JSON.stringify(Object.keys(req.headers))}`,
      );
    }
    if (mode === "enforce") {
      if (!check.valid) {
        logger.error("[Airtel Webhook] ⛔ Rejected callback with missing/invalid hash");
        return res.status(StatusCodes.FORBIDDEN).json({ status: "forbidden" });
      }
      trusted = true;
    }
  }

  try {
    const result = await PaymentService.handleAirtelWebhook(req.body, { trusted });
    res.status(StatusCodes.OK).json(result);
  } catch (err) {
    logger.error("[PaymentController.handleAirtelWebhook] Processing failed:", err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ status: "error" });
  }
};

export const PaymentController = {
  getPackages,
  initiatePayment,
  getPaymentStatus,
  ipAllowlist,
  handlePayLeoWebhook,
  handleAirtelWebhook,
};
