import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";

import AppError from "errors/AppError";
import { BroadcastRepository } from "module/broadcast/broadcast.repository";

import { FollowCacheManager } from "./follow.cacheManage";
import { FollowRepository } from "./follow.repository";
import { BroadcastCacheManager } from "module/broadcast/broadcast.cacheManage";

// ─── Payload Types ───────────────────────────────────────────────────────────

type TFollowPayload = {
  notificationsEnabled?: boolean;
};

type TFollowQuery = Record<string, unknown>;

// ─── Internal Helpers ────────────────────────────────────────────────────────

const parsePage = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const parseLimit = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 100);
};

const getBroadcastOrFail = async (broadcastId: string) => {
  if (!Types.ObjectId.isValid(broadcastId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid broadcast ID");
  }

  const broadcast = await BroadcastRepository.findById(broadcastId).select("followersCount isActive").lean();
  if (!broadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  return broadcast;
};

const syncBroadcastCount = async (broadcastId: string, delta: number) => {
  const updatedBroadcast = await BroadcastRepository.updateById(broadcastId, {
    $inc: { followersCount: delta },
  });

  if (!updatedBroadcast) {
    throw new AppError(StatusCodes.NOT_FOUND, "Broadcast not found");
  }

  await BroadcastCacheManager.invalidateById(broadcastId);
  await BroadcastCacheManager.invalidateLists();
  await FollowCacheManager.setFollowerCount(broadcastId, updatedBroadcast.followersCount ?? 0);

  return updatedBroadcast.followersCount ?? 0;
};

// ─── Follow Actions ────────────────────────────────────────────────────────────

const getFollowStatus = async (userId: Types.ObjectId, broadcastId: string) => {
  const cachedStatus = await FollowCacheManager.getFollowStatus(String(userId), broadcastId);
  if (cachedStatus) {
    return cachedStatus;
  }

  const follow = await FollowRepository.findOne({ user: userId, broadcast: broadcastId }).select(
    "notificationsEnabled",
  );

  if (!follow) {
    const status = { following: false, notificationsEnabled: false };
    await FollowCacheManager.setFollowStatus(String(userId), broadcastId, status);
    return status;
  }

  const status = {
    following: true,
    notificationsEnabled: follow.notificationsEnabled,
  };
  await FollowCacheManager.setFollowStatus(String(userId), broadcastId, status);
  return status;
};

const followBroadcast = async (
  userId: Types.ObjectId,
  broadcastId: string,
  payload: TFollowPayload,
) => {
  await getBroadcastOrFail(broadcastId);

  const existingFollow = await FollowRepository.findOne({ user: userId, broadcast: broadcastId });

  if (existingFollow) {
    if (
      payload.notificationsEnabled !== undefined &&
      existingFollow.notificationsEnabled !== payload.notificationsEnabled
    ) {
      const updatedFollow = await FollowRepository.updateById(String(existingFollow._id), {
        notificationsEnabled: payload.notificationsEnabled,
      });

      if (!updatedFollow) {
        throw new AppError(StatusCodes.NOT_FOUND, "Follow not found");
      }

      await FollowCacheManager.setFollowStatus(String(userId), broadcastId, {
        following: true,
        notificationsEnabled: updatedFollow.notificationsEnabled,
      });

      return {
        follow: updatedFollow.toObject(),
        alreadyFollowing: true,
      };
    }

    await FollowCacheManager.setFollowStatus(String(userId), broadcastId, {
      following: true,
      notificationsEnabled: existingFollow.notificationsEnabled,
    });

    return {
      follow: existingFollow.toObject(),
      alreadyFollowing: true,
    };
  }

  const follow = await FollowRepository.create({
    user: userId,
    broadcast: new Types.ObjectId(broadcastId),
    notificationsEnabled: payload.notificationsEnabled ?? true,
  });

  const updatedCount = await syncBroadcastCount(broadcastId, 1);

  await FollowCacheManager.setFollowStatus(String(userId), broadcastId, {
    following: true,
    notificationsEnabled: follow.notificationsEnabled,
  });
  await FollowCacheManager.setFollowerCount(broadcastId, updatedCount);

  return {
    follow: follow.toObject(),
    alreadyFollowing: false,
  };
};

const updateFollowPreferences = async (
  userId: Types.ObjectId,
  broadcastId: string,
  payload: TFollowPayload,
) => {
  if (payload.notificationsEnabled === undefined) {
    throw new AppError(StatusCodes.BAD_REQUEST, "notificationsEnabled is required");
  }

  const follow = await FollowRepository.findOneAndUpdate(
    { user: userId, broadcast: broadcastId },
    { notificationsEnabled: payload.notificationsEnabled },
    { returnDocument: "after" },
  );

  if (!follow) {
    throw new AppError(StatusCodes.NOT_FOUND, "Follow not found");
  }

  await FollowCacheManager.setFollowStatus(String(userId), broadcastId, {
    following: true,
    notificationsEnabled: follow.notificationsEnabled,
  });

  return { follow: follow.toObject() };
};

const unfollowBroadcast = async (userId: Types.ObjectId, broadcastId: string) => {
  const follow = await FollowRepository.findOne({ user: userId, broadcast: broadcastId });

  if (!follow) {
    await FollowCacheManager.setFollowStatus(String(userId), broadcastId, {
      following: false,
      notificationsEnabled: false,
    });

    return { message: "You are not following this broadcast" };
  }

  await FollowRepository.deleteById(String(follow._id));
  const updatedCount = await syncBroadcastCount(broadcastId, -1);

  await FollowCacheManager.setFollowStatus(String(userId), broadcastId, {
    following: false,
    notificationsEnabled: false,
  });
  await FollowCacheManager.setFollowerCount(broadcastId, updatedCount);

  return { message: "Broadcast unfollowed successfully" };
};

const listMyFollows = async (userId: Types.ObjectId, query: TFollowQuery) => {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 20);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    FollowRepository.findMany({ user: userId }, {
      sort: { createdAt: -1 },
      skip,
      limit,
      populate: "broadcast",
    }).lean(),
    FollowRepository.count({ user: userId }),
  ]);

  return {
    items,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

export const FollowService = {
  followBroadcast,
  getFollowStatus,
  updateFollowPreferences,
  unfollowBroadcast,
  listMyFollows,
};