import { StationApiKey } from "./stationApiKey.model";
import { TStationApiKey } from "./stationApiKey.interface";

const findByStation = (stationId: string) => {
  return StationApiKey.find({ station: stationId })
    .sort({ createdAt: -1 })
    .lean();
};

const findById = (id: string) => {
  return StationApiKey.findById(id).lean();
};

const findByKey = (key: string) => {
  const crypto = require("crypto");
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  return StationApiKey.findOne({
    $or: [{ key }, { key: keyHash }],
    isActive: true,
  }).lean();
};

const create = (data: Partial<TStationApiKey>) => {
  return StationApiKey.create(data).then((doc) => doc.toObject());
};

const deactivate = (id: string, stationId: string) => {
  return StationApiKey.findOneAndUpdate(
    { _id: id, station: stationId },
    { isActive: false },
    { new: true },
  ).lean();
};

const deactivateByStation = (stationId: string) => {
  return StationApiKey.updateMany(
    { station: stationId, isActive: true },
    { $set: { isActive: false } },
  ).then((result) => ({ modifiedCount: result.modifiedCount }));
};

const incrementHits = async (id: string, responseTimeMs: number) => {
  // Read current values, compute new average, then update atomically
  const doc = await StationApiKey.findById(id).lean();
  if (!doc) return null;

  const oldTotal = doc.totalHits || 0;
  const oldAvg = doc.avgResponseTimeMs || 0;
  const newTotal = oldTotal + 1;
  const newAvg = Math.round(((oldAvg * oldTotal) + responseTimeMs) / newTotal);

  return StationApiKey.findByIdAndUpdate(
    id,
    {
      $set: {
        totalHits: newTotal,
        lastUsedAt: new Date(),
        avgResponseTimeMs: newAvg,
      },
    },
    { new: true },
  ).lean();
};

export const StationApiKeyRepository = {
  findByStation,
  findById,
  findByKey,
  create,
  deactivate,
  deactivateByStation,
  incrementHits,
};
