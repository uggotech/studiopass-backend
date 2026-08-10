import mongoose from "mongoose";
import ListenerStatement from "./listenerStatement.model";
import { TListenerStatement } from "./listenerStatement.interface";

const findAll = (
  filter: Record<string, unknown>,
  options: { skip?: number; limit?: number } = {},
): Promise<TListenerStatement[]> => {
  const query = ListenerStatement.find(filter)
    .populate("station", "name stationCode category")
    .populate("show", "name")
    .populate("country", "name code currency currencySymbol")
    .sort({ createdAt: -1 });

  if (options.skip) query.skip(options.skip);
  if (options.limit) query.limit(options.limit);

  return query.lean();
};

const findById = (id: string): Promise<TListenerStatement | null> => {
  return ListenerStatement.findById(id)
    .populate("station", "name stationCode category country")
    .populate("show", "name days startTime endTime")
    .populate("country", "name code currency currencySymbol timezone")
    .lean();
};

const count = (filter: Record<string, unknown>): Promise<number> => {
  return ListenerStatement.countDocuments(filter);
};

const create = (data: Partial<TListenerStatement>): Promise<TListenerStatement> => {
  return ListenerStatement.create(data);
};

const findOne = (filter: Record<string, unknown>): Promise<TListenerStatement | null> => {
  return ListenerStatement.findOne(filter).lean();
};

const getAggregation = async (
  filter: Record<string, unknown>,
): Promise<{
  totalInteractions: number;
  totalMessages: number;
  totalCalls: number;
  totalRevenue: number;
}> => {
  const matchFilter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (
      (key === "user" || key === "station" || key === "show" || key === "country") &&
      typeof value === "string" &&
      mongoose.Types.ObjectId.isValid(value)
    ) {
      matchFilter[key] = new mongoose.Types.ObjectId(value);
    } else if (
      (key === "user" || key === "station" || key === "show" || key === "country") &&
      (value as any)?.$in
    ) {
      matchFilter[key] = {
        $in: (value as any).$in.map((val: any) =>
          typeof val === "string" && mongoose.Types.ObjectId.isValid(val)
            ? new mongoose.Types.ObjectId(val)
            : val
        ),
      };
    } else {
      matchFilter[key] = value;
    }
  }

  const result = await ListenerStatement.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalInteractions: { $sum: 1 },
        totalMessages: {
          $sum: { $cond: [{ $eq: ["$type", "Message"] }, 1, 0] },
        },
        totalCalls: {
          $sum: { $cond: [{ $eq: ["$type", "Call"] }, 1, 0] },
        },
        totalRevenue: {
          $sum: { $cond: ["$isFree", 0, "$amount"] },
        },
      },
    },
  ]);

  if (result.length === 0) {
    return {
      totalInteractions: 0,
      totalMessages: 0,
      totalCalls: 0,
      totalRevenue: 0,
    };
  }

  const { totalInteractions, totalMessages, totalCalls, totalRevenue } = result[0];
  return { totalInteractions, totalMessages, totalCalls, totalRevenue };
};

export const ListenerStatementRepository = {
  findAll,
  findById,
  findOne,
  count,
  create,
  getAggregation,
};
