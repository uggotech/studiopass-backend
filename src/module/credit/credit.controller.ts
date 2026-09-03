import { Request, Response } from "express";
import mongoose from "mongoose";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { CreditService } from "./credit.service";
import { CreditRepository } from "./credit.repository";
import { StatusCodes } from "http-status-codes";
import { Station } from "../station/station.model";
import { User } from "../user/user.model";
import { Partner } from "../partner/partner.model";
import AppError from "../../errors/AppError";

/**
 * Shared helper to verify that a staff user has permission to access or modify a target listener's credits.
 */
const verifyAdminAccessToUser = async (caller: any, targetUserId: string) => {
  const role = caller.role;
  if (role === "super_admin") return; // Super admin has global unrestricted access

  const targetUser = await User.findById(targetUserId).select("countryId role").lean();
  if (!targetUser) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (role === "partner_admin" || role === "customer_care") {
    if (!caller.partnerId) {
      throw new AppError(StatusCodes.FORBIDDEN, "Access denied: missing partner assignment");
    }
    const partner = await Partner.findById(caller.partnerId).select("country").lean();
    const partnerCountryId = (partner?.country as any)?._id?.toString() || partner?.country?.toString();

    // If partner has an assigned country, verify target listener belongs to that country
    if (partnerCountryId && targetUser.countryId?.toString() !== partnerCountryId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only access users within your assigned country");
    }
    return;
  }

  throw new AppError(StatusCodes.FORBIDDEN, "You do not have permission to access user credit records");
};

const getBalance = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const role = user.role;

  // Admin can view any user's balance via query param, end user can only view their own
  const userId = (role !== "user" && req.query.userId)
    ? req.query.userId as string
    : user._id.toString();

  if (role !== "user" && req.query.userId) {
    await verifyAdminAccessToUser(user, userId);
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
  const { userId, amount, isFree, reason } = req.body;

  await verifyAdminAccessToUser(user, userId);

  const idempotencyKey = req.headers["x-idempotency-key"] as string | undefined;
  const result = await CreditService.addCredits(
    userId,
    amount,
    adminId,
    isFree,
    undefined,
    undefined,
    idempotencyKey,
    reason,
    { role: user.role, fullName: user.fullName },
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credits added successfully",
    data: result,
  });
});

const deductCredits = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const adminId = user._id.toString();
  const { userId, amount, reason } = req.body;

  await verifyAdminAccessToUser(user, userId);

  const result = await CreditService.deductCreditsByAdmin(
    userId,
    amount,
    adminId,
    reason,
    { role: user.role, fullName: user.fullName },
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Credits deducted successfully",
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
    // Admin viewing a specific user's transactions
    const targetUserId = req.query.userId as string;
    await verifyAdminAccessToUser(user, targetUserId);
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

  // Additional filters for Super Admin / Partner reporting
  if (req.query.status && req.query.status !== "all") {
    filter.status = req.query.status;
  }

  if (req.query.country && req.query.country !== "all") {
    const countryVal = req.query.country as string;
    if (mongoose.Types.ObjectId.isValid(countryVal)) {
      filter.country = new mongoose.Types.ObjectId(countryVal);
    }
  }

  const andClauses: any[] = [];

  if (req.query.partner && req.query.partner !== "all" && !filter.station) {
    const partnerStations = await Station.find({ partner: req.query.partner }).select("_id").lean();
    const stationIds = partnerStations.map((s) => s._id);
    const partnerUsers = await User.find({ partnerId: req.query.partner }).select("_id").lean();
    const userIds = partnerUsers.map((u) => u._id);

    const partnerConds: any[] = [];
    if (stationIds.length > 0) {
      partnerConds.push({ station: { $in: stationIds } });
    }
    if (userIds.length > 0) {
      partnerConds.push({ user: { $in: userIds } });
    }
    if (partnerConds.length > 0) {
      andClauses.push({ $or: partnerConds });
    }
  }

  if (req.query.startDate || req.query.endDate) {
    const dateCond: any = {};
    if (req.query.startDate) {
      dateCond.$gte = new Date(req.query.startDate as string);
    }
    if (req.query.endDate) {
      const end = new Date(req.query.endDate as string);
      end.setHours(23, 59, 59, 999);
      dateCond.$lte = end;
    }
    filter.createdAt = dateCond;
  }

  if (req.query.search) {
    const searchStr = (req.query.search as string).trim();
    if (searchStr) {
      const regex = new RegExp(searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const matchingUsers = await User.find({
        $or: [{ fullName: regex }, { phone: regex }, { email: regex }],
      }).select("_id").lean();
      const userIds = matchingUsers.map((u) => u._id);

      const orConditions: any[] = [
        { paymentReference: regex },
        { paymentProvider: regex },
        { reason: regex },
      ];
      if (userIds.length > 0) {
        orConditions.push({ user: { $in: userIds } });
      }
      if (mongoose.Types.ObjectId.isValid(searchStr)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(searchStr) });
      }
      andClauses.push({ $or: orConditions });
    }
  }

  if (andClauses.length > 0) {
    filter.$and = andClauses;
  }

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
  deductCredits,
  getTransactions,
};
