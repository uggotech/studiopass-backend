import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { CreditService } from "./credit.service";
import { CreditRepository } from "./credit.repository";
import { StatusCodes } from "http-status-codes";

const getBalance = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const role = user.role;

  // Admin can view any user's balance via query param, user can only view own
  const userId = (role !== "user" && req.query.userId)
    ? req.query.userId as string
    : user._id.toString();

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

  const result = await CreditService.addCredits(userId, amount, adminId, isFree);

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

  // Admin can view any user's transactions via query param
  const userId = (role !== "user" && req.query.userId)
    ? req.query.userId as string
    : user._id.toString();

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    CreditRepository.getTransactionsByUser(userId, skip, limit),
    CreditRepository.countTransactionsByUser(userId),
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
