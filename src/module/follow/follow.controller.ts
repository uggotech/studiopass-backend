import { StatusCodes } from "http-status-codes";

import AppError from "errors/AppError";
import catchAsync from "@shared/catchAsync";
import sendResponse from "@shared/sendResponse";

import { FollowService } from "./follow.service";

// ─── Utility Helpers ─────────────────────────────────────────────────────────

const getBroadcastId = (req: { params: { broadcastId?: string } }) => {
  const broadcastId = req.params.broadcastId;

  if (!broadcastId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Broadcast ID is required");
  }

  return broadcastId;
};

// ─── Follow Broadcast ────────────────────────────────────────────────────────
// Handles requests to follow or subscribe to a broadcast channel.

const followBroadcast = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await FollowService.followBroadcast(userId, getBroadcastId(req), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: result.alreadyFollowing ? "Broadcast already followed" : "Broadcast followed successfully",
    data: result.follow,
  });
});

// ─── Update Follow Preferences ───────────────────────────────────────────────
// Update settings for a followed broadcast (e.g. disable notifications).

const updateFollowPreferences = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await FollowService.updateFollowPreferences(userId, getBroadcastId(req), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Follow preferences updated successfully",
    data: result.follow,
  });
});

// ─── Unfollow Broadcast ──────────────────────────────────────────────────────
// Unsubscribes a user from a broadcast channel.

const unfollowBroadcast = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await FollowService.unfollowBroadcast(userId, getBroadcastId(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

// ─── List My Follows ─────────────────────────────────────────────────────────
// Retrieve all broadcast channels currently followed by the authenticated user.

const listMyFollows = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const result = await FollowService.listMyFollows(userId, req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Followed broadcasts fetched successfully",
    meta: result.meta,
    data: result.items,
  });
});

// ─── Get Follow Status ───────────────────────────────────────────────────────
// Get boolean status checking if current user follows a specific broadcase.

const getFollowStatus = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(StatusCodes.UNAUTHORIZED, "Unauthorized");

  const status = await FollowService.getFollowStatus(userId, getBroadcastId(req));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Follow status fetched successfully",
    data: status,
  });
});

export const FollowController = {
  followBroadcast,
  updateFollowPreferences,
  unfollowBroadcast,
  listMyFollows,
  getFollowStatus,
};