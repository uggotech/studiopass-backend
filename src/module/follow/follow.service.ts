import { Types } from "mongoose";
import { Follow } from "./follow.model";
import { Station } from "../station/station.model";
import AppError from "../../errors/AppError";
import { StatusCodes } from "http-status-codes";

const toggleFollow = async (userId: string, stationId: string) => {
  const station = await Station.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const existingFollow = await Follow.findOne({
    user: userId,
    station: stationId,
  });

  let following: boolean;
  let followersCount: number;

  if (existingFollow) {
    // Unfollow — atomic delete + decrement
    await Follow.deleteOne({ _id: existingFollow._id });
    const updated = await Station.findByIdAndUpdate(
      stationId,
      { $inc: { followersCount: -1 } },
      { new: true },
    ).select("followersCount");
    following = false;
    followersCount = updated?.followersCount ?? 0;
  } else {
    // Follow — use try-catch for duplicate key error (race condition safety)
    try {
      await Follow.create({ user: userId, station: stationId });
    } catch (error: any) {
      // Duplicate key error = already following (concurrent request)
      if (error?.code === 11000) {
        const existing = await Follow.findOne({ user: userId, station: stationId });
        if (existing) {
          const updated = await Station.findById(stationId).select("followersCount");
          return { following: true, followersCount: updated?.followersCount ?? 0 };
        }
      }
      throw error;
    }
    const updated = await Station.findByIdAndUpdate(
      stationId,
      { $inc: { followersCount: 1 } },
      { new: true },
    ).select("followersCount");
    following = true;
    followersCount = updated?.followersCount ?? 0;
  }

  return { following, followersCount };
};

const getFollowStatus = async (
  userId: string | undefined,
  stationIds: Types.ObjectId[],
): Promise<Map<string, boolean>> => {
  const followedMap = new Map<string, boolean>();

  if (!userId || stationIds.length === 0) {
    return followedMap;
  }

  const follows = await Follow.find({
    user: userId,
    station: { $in: stationIds },
  })
    .select("station")
    .lean();

  follows.forEach((f) => {
    followedMap.set(f.station.toString(), true);
  });

  return followedMap;
};

export const FollowService = {
  toggleFollow,
  getFollowStatus,
};
