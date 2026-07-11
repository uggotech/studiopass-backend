import mongoose from "mongoose";
import { Station } from "./station.model";
import { TStation } from "./station.interface";

const findAll = (
  filter: Record<string, unknown>,
  options: { skip?: number; limit?: number } = {},
): Promise<TStation[]> => {
  const query = Station.find(filter)
    .populate("country", "name code phoneCode currency currencySymbol timezone")
    .populate("partner", "name")
    .sort({ createdAt: -1 });

  if (options.skip) query.skip(options.skip);
  if (options.limit) query.limit(options.limit);

  return query.lean();
};

const findById = (id: string): Promise<TStation | null> => {
  return Station.findById(id)
    .populate("country", "name code phoneCode currency currencySymbol timezone")
    .populate("partner", "name")
    .lean();
};

const findByStationCode = (stationCode: string): Promise<TStation | null> => {
  return Station.findOne({ stationCode: stationCode.toUpperCase() }).lean();
};

const count = (filter: Record<string, unknown>): Promise<number> => {
  return Station.countDocuments(filter);
};

const create = (data: Partial<TStation>, session?: mongoose.ClientSession): Promise<TStation> => {
  if (session) {
    return Station.create([data]).then(([doc]) => doc as TStation);
  }
  return Station.create(data);
};

const updateById = (id: string, data: Partial<TStation>): Promise<TStation | null> => {
  return Station.findByIdAndUpdate(id, data, { new: true })
    .populate("country", "name code phoneCode currency currencySymbol timezone")
    .populate("partner", "name")
    .lean();
};

export const StationRepository = {
  findAll,
  findById,
  findByStationCode,
  count,
  create,
  updateById,
};
