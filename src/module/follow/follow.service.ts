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
    // Unfollow
    await Follow.deleteOne({ _id: existingFollow._id });
    await Station.findByIdAndUpdate(stationId, { $inc: { followersCount: -1 } });
    const updated = await Station.findById(stationId).select("followersCount");
    following = false;
    followersCount = updated?.followersCount ?? 0;
  } else {
    // Follow
    await Follow.create({ user: userId, station: stationId });
    await Station.findByIdAndUpdate(stationId, { $inc: { followersCount: 1 } });
    const updated = await Station.findById(stationId).select("followersCount");
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
