import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { FollowService } from "./follow.service";
import { StatusCodes } from "http-status-codes";

const toggleFollow = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userId = user._id.toString();
  const stationId = String(req.params.stationId);

  const result = await FollowService.toggleFollow(userId, stationId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.following ? "Station followed" : "Station unfollowed",
    data: result,
  });
});

export const FollowController = {
  toggleFollow,
};
