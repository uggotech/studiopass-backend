import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import fs from "fs";
import path from "path";

import AppError from "errors/AppError";
import { UserCacheManager, TCachedUserProfile } from "./user.cacheManage";
import { UserRepository } from "./user.repository";
import { checkProfileComplete, IUserPreferences, TUser } from "./user.interface";
import { AuthRepository } from "module/auth/auth.repository";

// ─── Types ────────────────────────────────────────────────────────────────────

type TUpdateProfilePayload = {
  fullName?: string;
  email?: string;
  preferences?: Partial<IUserPreferences>;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const getCachedUserProfile = async (
  userId: Types.ObjectId | string,
): Promise<TCachedUserProfile> => {
  const cached = await UserCacheManager.getProfile(String(userId));
  if (cached) return cached;

  const userDoc = await UserRepository.findById(String(userId), { populate: "auth" }).lean<any>();

  if (!userDoc) throw new AppError(StatusCodes.NOT_FOUND, "User not found");

  // Flatten role from auth and ensure auth is just the ID
  const user = {
    ...userDoc,
    role: userDoc.role || userDoc.auth?.role,
    auth: userDoc.auth?._id || userDoc.auth,
  };

  await UserCacheManager.setProfile(String(userId), user);
  return user;
};

const recomputeProfileCompletion = async (
  userId: Types.ObjectId,
  user: TUser,
): Promise<boolean> => {
  const isComplete = checkProfileComplete(user);
  if (user.profileCompleted !== isComplete) {
    await UserRepository.updateById(String(userId), { profileCompleted: isComplete });
    user.profileCompleted = isComplete;
  }
  return isComplete;
};

const projectUserFields = (
  user: TCachedUserProfile,
  rawFields: unknown,
): TCachedUserProfile => {
  if (typeof rawFields !== "string" || !rawFields.trim()) return user;

  const fields = rawFields
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (!fields.length) return user;

  if (fields.every((f) => f.startsWith("-"))) {
    const result = { ...user };
    fields.forEach((f) => delete result[f.slice(1)]);
    return result;
  }

  const projected: TCachedUserProfile = {};
  if (user._id !== undefined) projected._id = user._id;
  fields
    .filter((f) => !f.startsWith("-"))
    .forEach((f) => { if (f in user) projected[f] = user[f]; });
  return projected;
};

// ─── Service ──────────────────────────────────────────────────────────────────

const getMe = async (userId: Types.ObjectId, query: Record<string, unknown>) => {
  const user = await getCachedUserProfile(userId);
  return projectUserFields(user, query.fields);
};

const getById = async (id: string, query: Record<string, unknown>) => {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid user ID");
  }
  const user = await getCachedUserProfile(id);
  return projectUserFields(user, query.fields);
};

const updateProfile = async (
  userId: Types.ObjectId,
  payload: TUpdateProfilePayload,
) => {
  const user = await UserRepository.findById(String(userId));
  if (!user) throw new AppError(StatusCodes.NOT_FOUND, "User not found");

  const updateFields: Partial<TUser> = {};
  if (payload.fullName !== undefined) updateFields.fullName = payload.fullName;
  if (payload.email !== undefined) updateFields.email = payload.email;
  if (payload.preferences !== undefined) {
    updateFields.preferences = { ...user.preferences, ...payload.preferences };
  }

  const updatedUser = await UserRepository.updateById(String(userId), updateFields);
  if (!updatedUser) throw new AppError(StatusCodes.NOT_FOUND, "User not found");

  const isCompleteProfile = await recomputeProfileCompletion(userId, updatedUser);

  await UserCacheManager.setProfile(
    String(userId),
    updatedUser.toObject() as unknown as TCachedUserProfile,
  );

  return { user: updatedUser.toObject(), isCompleteProfile };
};

const deleteMe = async (userId: Types.ObjectId) => {
  const user = await UserRepository.findById(String(userId));
  if (!user) throw new AppError(StatusCodes.NOT_FOUND, "User not found");

  await UserRepository.updateById(String(userId), { isDeleted: true });
  await UserCacheManager.invalidateProfile(String(userId));

  return { message: "Account deleted successfully" };
};

const updateAvatar = async (userId: Types.ObjectId, file: Express.Multer.File) => {
  const user = await UserRepository.findById(String(userId));
  if (!user) throw new AppError(StatusCodes.NOT_FOUND, "User not found");

  // Remove old avatar file
  if (user.avatar) {
    const oldPath = path.join(process.cwd(), user.avatar);
    if (fs.existsSync(oldPath)) {
      await fs.promises.unlink(oldPath).catch(() => {});
    }
  }

  const avatarPath = `uploads/images/${file.filename}`;
  const updatedUser = await UserRepository.updateById(String(userId), { avatar: avatarPath });
  if (!updatedUser) throw new AppError(StatusCodes.NOT_FOUND, "User not found");

  const isCompleteProfile = await recomputeProfileCompletion(userId, updatedUser);

  await UserCacheManager.setProfile(
    String(userId),
    updatedUser.toObject() as unknown as TCachedUserProfile,
  );

  return { user: updatedUser.toObject(), isCompleteProfile };
};

export const UserService = {
  getMe,
  getById,
  updateProfile,
  deleteMe,
  updateAvatar,
};

