import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { CreditService } from "./credit.service";
import { CreditRepository } from "./credit.repository";
import { StatusCodes } from "http-status-codes";
import { Station } from "../station/station.model";
import { User } from "../user/user.model";
import AppError from "../../errors/AppError";

const getBalance = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const role = user.role;

  // Admin can view any user's balance via query param, user can only view own
  const userId = (role !== "user" && req.query.userId)
    ? req.query.userId as string
    : user._id.toString();

  // Scope check: ensure the target user falls within the requesting user's scope
  if (role === "partner_admin" && req.query.userId && user.partnerId) {
    const targetUser = await User.findById(userId).select("partnerId").lean();
    if (!targetUser || targetUser.partnerId?.toString() !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view balances of users in your partner organization");
    }
  } else if (role === "station_admin" && req.query.userId && user.stationId) {
    const targetUser = await User.findById(userId).select("stationId").lean();
    if (!targetUser || targetUser.stationId?.toString() !== user.stationId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view balances of users in your station");
    }
  }

  const result = await CreditService.getBalance(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit balance fetched successfully",
    data: result,
  });
});

const addCredits = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const adminId = user._id.toString();
  const { userId, amount, isFree } = req.body;

  // Scope check: ensure the target user falls within the requesting user's scope
  if (user.role === "partner_admin" && user.partnerId) {
    const targetUser = await User.findById(userId).select("partnerId").lean();
    if (!targetUser || targetUser.partnerId?.toString() !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only add credits to users in your partner organization");
    }
  } else if (user.role === "station_admin" && user.stationId) {
    const targetUser = await User.findById(userId).select("stationId").lean();
    if (!targetUser || targetUser.stationId?.toString() !== user.stationId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only add credits to users in your station");
    }
  }

  const idempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
  const result = await CreditService.addCredits(userId, amount, adminId, isFree, undefined, undefined, idempotencyKey);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credits added successfully",
    data: result,
  });
});

const getTransactions = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const role = user.role;

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  // Build filter based on role scope
  const filter: Record<string, unknown> = {};

  if (role === "user") {
    // Users can only see their own transactions
    filter.user = user._id;
  } else if (req.query.userId) {
    // Admin viewing a specific user's transactions — scope check required
    const targetUserId = req.query.userId as string;
    if (role === "partner_admin" && user.partnerId) {
      const targetUser = await User.findById(targetUserId).select("partnerId").lean();
      if (!targetUser || targetUser.partnerId?.toString() !== user.partnerId.toString()) {
        throw new AppError(StatusCodes.FORBIDDEN, "You can only view transactions of users in your partner organization");
      }
    } else if (role === "station_admin" && user.stationId) {
      const targetUser = await User.findById(targetUserId).select("stationId").lean();
      if (!targetUser || targetUser.stationId?.toString() !== user.stationId.toString()) {
        throw new AppError(StatusCodes.FORBIDDEN, "You can only view transactions of users in your station");
      }
    } else if (role !== "super_admin") {
      // For any other non-super_admin role with userId, deny access
      throw new AppError(StatusCodes.FORBIDDEN, "You don't have permission to view other users' transactions");
    }
    filter.user = targetUserId;
  } else if (role === "station_admin" && user.stationId) {
    // Station admin: transactions where station matches their station
    filter.station = user.stationId;
  } else if (role === "partner_admin" && user.partnerId) {
    // Partner admin: transactions where station belongs to their partner
    const partnerStations = await Station.find({ partner: user.partnerId }).select("_id").lean();
    const stationIds = partnerStations.map((s) => s._id);
    if (stationIds.length > 0) {
      filter.station = { $in: stationIds };
    }
  }
  // super_admin: no filter = all transactions

  const [transactions, total] = await Promise.all([
    CreditRepository.getAllTransactions(filter, skip, limit),
    CreditRepository.countAllTransactions(filter),
  ]);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credit transactions fetched successfully",
    data: transactions,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  });
});

export const CreditController = {
  getBalance,
  addCredits,
  getTransactions,
};
