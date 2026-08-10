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
  return Challenge.findByIdAndUpdate(id, update, { new: true }).lean();
};

const deleteById = (id: string) => {
  return Challenge.findByIdAndDelete(id);
};

const incrementParticipants = (id: string, count: number = 1) => {
  return Challenge.findByIdAndUpdate(
    id,
    { $inc: { totalParticipants: count } },
    { new: true },
  ).lean();
};

const countActiveByStation = (stationId: string) => {
  return Challenge.countDocuments({ station: stationId, status: "active" });
};

export const ChallengeRepository = {
  create,
  findById,
  findByStation,
  countByStation,
  countActiveByStation,
  findAll,
  count,
  updateById,
  deleteById,
  incrementParticipants,
};
