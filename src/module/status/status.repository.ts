import mongoose from "mongoose";
import { Status } from "./status.model";

const create = (data: Record<string, unknown>) => {
  const doc = new Status(data);
  return doc.save().then((d) => d.toObject());
};

const findById = (id: string) => {
  return Status.findById(id)
    .populate("station", "name stationCode logo")
    .populate("createdBy", "fullName")
    .populate("topFan.user", "fullName avatar")
    .lean();
};

const findActiveByStation = (stationId: string, skip: number, limit: number) => {
  return Status.find({
    station: stationId,
    expiresAt: { $gt: new Date() },
  })
    .populate("topFan.user", "fullName avatar")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countActiveByStation = (stationId: string) => {
  return Status.countDocuments({
    station: stationId,
    expiresAt: { $gt: new Date() },
  });
};

const findAll = (filter: Record<string, unknown>, opts: { skip: number; limit: number }) => {
  return Status.find(filter)
    .populate("station", "name stationCode logo")
    .populate("createdBy", "fullName")
    .populate("topFan.user", "fullName avatar")
    .sort({ createdAt: -1 })
    .skip(opts.skip)
    .limit(opts.limit)
    .lean();
};

const count = (filter: Record<string, unknown>) => {
  return Status.countDocuments(filter);
};

const updateById = (id: string, update: Record<string, unknown>) => {
  return Status.findByIdAndUpdate(id, update, { new: true }).lean();
};

const deleteById = (id: string) => {
  return Status.findByIdAndDelete(id);
};

const incrementViewCount = (id: string) => {
  return Status.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { new: true }).lean();
};

const incrementLikeCount = (id: string) => {
  return Status.findByIdAndUpdate(id, { $inc: { likeCount: 1 } }, { new: true }).lean();
};

const decrementLikeCount = (id: string) => {
  return Status.findByIdAndUpdate(
    id,
    [
      {
        $set: {
          likeCount: {
            $max: [0, { $subtract: [{ $ifNull: ["$likeCount", 0] }, 1] }],
          },
        },
      },
    ],
    { new: true },
  ).lean();
};

const findActiveForStation = (stationId: string) => {
  return Status.find({
    station: stationId,
    type: "auto_weekly_top_fans",
    expiresAt: { $gt: new Date() },
  }).lean();
};

const findByStationAndWeek = (stationId: string, weekStart: Date) => {
  return Status.findOne({
    station: stationId,
    type: "auto_weekly_top_fans",
    weekStart,
  }).lean();
};

const createMany = (docs: Record<string, unknown>[]) => {
  return Status.insertMany(docs);
};

const findActiveByCountry = (countryId: string, userId?: string) => {
  const countryObjectId = new mongoose.Types.ObjectId(countryId);
  const userObjectId = userId && mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;

  return Status.aggregate([
    {
      $match: {
        expiresAt: { $gt: new Date() },
      },
    },
    {
      $lookup: {
        from: "stations",
        localField: "station",
        foreignField: "_id",
        as: "stationDoc",
      },
    },
    { $unwind: "$stationDoc" },
    {
      $match: {
        "stationDoc.country": countryObjectId,
        "stationDoc.isActive": true,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "topFan.user",
        foreignField: "_id",
        as: "topFanUserDoc",
      },
    },
    ...(userObjectId
      ? [
          {
            $lookup: {
              from: "statusviews",
              let: { statusId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$status", "$$statusId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    },
                  },
                },
              ],
              as: "userView",
            },
          },
          {
            $lookup: {
              from: "statuslikes",
              let: { statusId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$status", "$$statusId"] },
                        { $eq: ["$user", userObjectId] },
                      ],
                    },
                  },
                },
              ],
              as: "userLike",
            },
          },
        ]
      : []),
    {
      $addFields: {
        stationName: "$stationDoc.name",
        stationLogo: "$stationDoc.logo",
        stationIsVerified: "$stationDoc.isVerified",
        isViewed: userObjectId ? { $gt: [{ $size: { $ifNull: ["$userView", []] } }, 0] } : false,
        isLiked: userObjectId ? { $gt: [{ $size: { $ifNull: ["$userLike", []] } }, 0] } : false,
        likeCount: { $ifNull: ["$likeCount", 0] },
        "topFan.user": {
          $cond: {
            if: { $gt: [{ $size: "$topFanUserDoc" }, 0] },
            then: { $arrayElemAt: ["$topFanUserDoc", 0] },
            else: "$topFan.user",
          },
        },
      },
    },
    {
      $project: {
        stationDoc: 0,
        topFanUserDoc: 0,
        userView: 0,
        userLike: 0,
      },
    },
    { $sort: { createdAt: -1 as const } },
  ]);
};

const findActiveByStationAll = (stationId: string) => {
  return Status.find({
    station: stationId,
    expiresAt: { $gt: new Date() },
  })
    .populate("station", "name stationCode logo")
    .populate("createdBy", "fullName")
    .sort({ createdAt: -1 })
    .lean();
};

const findAllByStation = (
  stationId: string | string[],
  skip: number,
  limit: number,
) => {
  const filter: Record<string, unknown> = {};
  if (Array.isArray(stationId)) {
    filter.station = { $in: stationId };
  } else if (stationId && stationId !== "all" && stationId !== "undefined") {
    filter.station = stationId;
  }
  return Status.find(filter)
    .populate("station", "name stationCode logo")
    .populate("createdBy", "fullName")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countAllByStation = (stationId: string | string[]) => {
  const filter: Record<string, unknown> = {};
  if (Array.isArray(stationId)) {
    filter.station = { $in: stationId };
  } else if (stationId && stationId !== "all" && stationId !== "undefined") {
    filter.station = stationId;
  }
  return Status.countDocuments(filter);
};

const getStationStatusMetrics = async (stationId: string | string[]) => {
  const filter: any = {};
  if (Array.isArray(stationId)) {
    filter.station = {
      $in: stationId.map((id) =>
        mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id,
      ),
    };
  } else if (stationId && stationId !== "all" && stationId !== "undefined") {
    filter.station = mongoose.Types.ObjectId.isValid(stationId)
      ? new mongoose.Types.ObjectId(stationId)
      : stationId;
  }

  const now = new Date();

  const results = await Status.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        totalViews: { $sum: "$viewCount" },
        totalLikes: { $sum: "$likeCount" },
        activeCount: {
          $sum: {
            $cond: [{ $gt: ["$expiresAt", now] }, 1, 0],
          },
        },
        expiredCount: {
          $sum: {
            $cond: [{ $lte: ["$expiresAt", now] }, 1, 0],
          },
        },
      },
    },
  ]);

  if (results.length > 0) {
    return {
      total: results[0].total || 0,
      totalViews: results[0].totalViews || 0,
      totalLikes: results[0].totalLikes || 0,
      activeCount: results[0].activeCount || 0,
      expiredCount: results[0].expiredCount || 0,
    };
  }

  return {
    total: 0,
    totalViews: 0,
    totalLikes: 0,
    activeCount: 0,
    expiredCount: 0,
  };
};

export const StatusRepository = {
  create,
  findById,
  findActiveByStation,
  countActiveByStation,
  findAll,
  count,
  updateById,
  deleteById,
  incrementViewCount,
  incrementLikeCount,
  decrementLikeCount,
  findActiveForStation,
  findByStationAndWeek,
  createMany,
  findActiveByCountry,
  findActiveByStationAll,
  findAllByStation,
  countAllByStation,
  getStationStatusMetrics,
};
