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

const findActiveByCountry = (countryId: string) => {
  const countryObjectId = new mongoose.Types.ObjectId(countryId);
  return Status.aggregate([
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
        expiresAt: { $gt: new Date() },
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
    {
      $addFields: {
        stationName: "$stationDoc.name",
        stationLogo: "$stationDoc.logo",
        stationIsVerified: "$stationDoc.isVerified",
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

const findAllByStation = (stationId: string, skip: number, limit: number) => {
  const filter: Record<string, unknown> = {};
  if (stationId && stationId !== "all" && stationId !== "undefined") {
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

const countAllByStation = (stationId: string) => {
  const filter: Record<string, unknown> = {};
  if (stationId && stationId !== "all" && stationId !== "undefined") {
    filter.station = stationId;
  }
  return Status.countDocuments(filter);
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
  findActiveForStation,
  findByStationAndWeek,
  createMany,
  findActiveByCountry,
  findActiveByStationAll,
  findAllByStation,
  countAllByStation,
};
