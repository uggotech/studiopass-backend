import { Router } from "express";

import auth from "@middlewares/auth";
import validateRequest from "@middlewares/validateRequest";
import fileUploadHandler from "@middlewares/fileUploadHandler";

import { BroadcastController } from "./broadcast.controller";
import { BroadcastDto } from "./broadcast.dto";

const router = Router();

/**
 * @route   GET /api/v1/broadcast
 * @desc    List all broadcasts with pagination, filtering, and search
 * @access  Public
 */
router.get("/", BroadcastController.listBroadcasts);

/**
 * @route   GET /api/v1/broadcast/:id
 * @desc    Get a specific broadcast by its ID
 * @access  Public
 */
router.get("/:id", BroadcastController.getBroadcast);

/**
 * @route   POST /api/v1/broadcast
 * @desc    Create a new broadcast channel
 * @access  Admin
 */
router.post(
  "/",
  auth("admin"),
  validateRequest(BroadcastDto.createBroadcast),
  BroadcastController.createBroadcast,
);

/**
 * @route   PATCH /api/v1/broadcast/:id
 * @desc    Update an existing broadcast channel along with its details
 * @access  Admin
 */
router.patch(
  "/:id",
  auth("admin"),
  validateRequest(BroadcastDto.updateBroadcast),
  BroadcastController.updateBroadcast,
);

/**
 * @route   DELETE /api/v1/broadcast/:id
 * @desc    Delete a broadcast and its associated data
 * @access  Admin
 */
router.delete("/:id", auth("admin"), BroadcastController.deleteBroadcast);

/**
 * @route   PATCH /api/v1/broadcast/:id/images
 * @desc    Upload logo and cover image for a broadcast (supports local files or URLs)
 * @access  Admin
 */
router.patch(
  "/:id/images",
  auth("admin"),
  fileUploadHandler,
  validateRequest(BroadcastDto.uploadBroadcastImages),
  BroadcastController.uploadBroadcastImages,
);

/**
 * @route   POST /api/v1/broadcast/:id/notify
 * @desc    Send a push notification to all followers of a specific broadcast
 * @access  Admin
 */
router.post(
  "/:id/notify",
  auth("admin"),
  validateRequest(BroadcastDto.sendBroadcastNotification),
  BroadcastController.sendBroadcastNotification,
);

export const BroadcastRoutes = router;