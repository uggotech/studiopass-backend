import mongoose from "mongoose";
import { Challenge } from "./challenge.model";

const create = (data: Record<string, unknown>) => {
  const doc = new Challenge(data);
  return doc.save().then((d) => d.toObject());
};

const findById = (id: string) => {
  return Challenge.findById(id).lean();
};

const findByStation = (stationId: string, skip: number, limit: number, status?: string) => {
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;
  return Challenge.find(filter)
    .populate("createdBy", "fullName")
    .sort({ startDate: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

const countByStation = (stationId: string, status?: string) => {
  const filter: Record<string, unknown> = { station: stationId };
  if (status) filter.status = status;
  return Challenge.countDocuments(filter);
};

const findAll = (filter: Record<string, unknown>, opts: { skip: number; limit: number }) => {
  return Challenge.find(filter)
    .populate("createdBy", "fullName")
    .populate("station", "name stationCode")
    .sort({ startDate: -1 })
    .skip(opts.skip)
    .limit(opts.limit)
    .lean();
};

const count = (filter: Record<string, unknown>) => {
  return Challenge.countDocuments(filter);
};

const updateById = (id: string, update: Record<string, unknown>) => {
  return Challenge.findByIdAndUpdate(id, update, { returnDocument: "after" }).lean();
};

/** Atomic conditional update — only updates if current status matches condition. Returns null if no match. */
const updateByIdConditional = (id: string, update: Record<string, unknown>) => {
  return Challenge.findOneAndUpdate(
    { _id: id, status: { $nin: ["completed", "cancelled"] } },
    update,
    { returnDocument: "after" },
  ).lean();
};

const deleteById = (id: string) => {
  return Challenge.findByIdAndDelete(id);
};

const incrementParticipants = (id: string, count: number = 1) => {
  return Challenge.findByIdAndUpdate(
    id,
    { $inc: { totalParticipants: count } },
    { returnDocument: "after" },
  ).lean();
};

const countActiveByStation = (stationId: string) => {
  return Challenge.countDocuments({ station: stationId, status: "active" });
};

/** Batch active-challenge counts for many stations in one aggregation (avoids N+1). */
const countActiveByStations = (stationIds: string[]) => {
  if (!stationIds.length) return Promise.resolve([] as { _id: string; count: number }[]);
  return Challenge.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        station: {
          $in: stationIds.map((id) => {
            try {
              return new mongoose.Types.ObjectId(id);
            } catch {
              return id;
            }
          }),
        },
        status: "active",
      },
    },
    { $group: { _id: { $toString: "$station" }, count: { $sum: 1 } } },
  ]);
};

const getStats = (filter: Record<string, unknown> = {}) => {
  return Challenge.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        scheduled: { $sum: { $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0] } },
        draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
        totalParticipants: { $sum: "$totalParticipants" },
      },
    },
  ]);
};

export const ChallengeRepository = {
  create,
  findById,
  findByStation,
  countByStation,
  countActiveByStation,
  countActiveByStations,
  getStats,
  findAll,
  count,
  updateById,
  updateByIdConditional,
  deleteById,
  incrementParticipants,
};
