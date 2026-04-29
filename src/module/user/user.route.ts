import { Router } from "express";
import auth from "@middlewares/auth";
import validateRequest from "@middlewares/validateRequest";
import fileUploadHandler from "@middlewares/fileUploadHandler";
import { UserController } from "./user.controller";
import { UserDto } from "./user.dto";

const router = Router();

/**
 * @route   GET /api/v1/user/me
 * @desc    Get the current authenticated user's profile (supports ?fields=fullName,avatar)
 * @access  Private
 */
router.get(
  "/me",
  auth(),
  UserController.getMe,
);

/**
 * @route   PATCH /api/v1/user/me
 * @desc    Update profile — fullName, email, and/or preferences
 * @access  Private
 */
router.patch(
  "/me",
  auth(),
  validateRequest(UserDto.updateProfile),
  UserController.updateProfile,
);

/**
 * @route   DELETE /api/v1/user/me
 * @desc    Soft-delete the current user's account
 * @access  Private
 */
router.delete(
  "/me",
  auth(),
  UserController.deleteMe,
);

/**
 * @route   PATCH /api/v1/user/me/avatar
 * @desc    Upload or replace the user's avatar image
 * @access  Private
 */
router.patch(
  "/me/avatar",
  auth(),
  fileUploadHandler,
  UserController.updateAvatar,
);

/**
 * @route   GET /api/v1/user/:id
 * @desc    Get another user's public profile by ID
 * @access  Private
 */
router.get(
  "/:id",
  auth(),
  UserController.getById,
);

export const UserRoutes = router;

