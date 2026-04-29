import { Router } from "express";

import auth from "@middlewares/auth";
import validateRequest from "@middlewares/validateRequest";

import { FollowController } from "./follow.controller";
import { FollowDto } from "./follow.dto";

const router = Router();

/**
 * @route   GET /api/v1/follows/me
 * @desc    Get top broadcasts followed by the currently authenticated user
 * @access  Private
 */
router.get("/me", auth(), FollowController.listMyFollows);

/**
 * @route   GET /api/v1/follows/:broadcastId/status
 * @desc    Check whether the current user is following a specific broadcast
 * @access  Private
 */
router.get("/:broadcastId/status", auth(), FollowController.getFollowStatus);

/**
 * @route   POST /api/v1/follows/:broadcastId
 * @desc    Follow a broadcast (triggers subscribing to FCM topic)
 * @access  Private
 */
router.post(
  "/:broadcastId",
  auth(),
  validateRequest(FollowDto.followBroadcast),
  FollowController.followBroadcast,
);

/**
 * @route   PATCH /api/v1/follows/:broadcastId
 * @desc    Update preferences for a specific broadcast follow (e.g., mute notifications)
 * @access  Private
 */
router.patch(
  "/:broadcastId",
  auth(),
  validateRequest(FollowDto.updateFollowPreferences),
  FollowController.updateFollowPreferences,
);

/**
 * @route   DELETE /api/v1/follows/:broadcastId
 * @desc    Unfollow a broadcast (triggers unsubscribing from FCM topic)
 * @access  Private
 */
router.delete("/:broadcastId", auth(), FollowController.unfollowBroadcast);

export const FollowRoutes = router;