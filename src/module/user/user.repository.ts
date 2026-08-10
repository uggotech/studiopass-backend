import mongoose from "mongoose";
import { User } from "./user.model";
import { TUser } from "./user.interface";
import { UserRole } from "shared/roles";

const findById = (id: string): Promise<TUser | null> => {
  return User.findById(id).lean();
};

const findByIdWithStation = (id: string): Promise<TUser | null> => {
  return User.findById(id)
    .populate("stationId", "name stationCode category logo coverImage description website")
    .populate("partnerId", "name")
    .lean();
};

const findByAuthId = (authId: string): Promise<TUser | null> => {
  return User.findOne({ auth: authId }).lean();
};

const findByPartnerIdAndRole = (partnerId: string, role: UserRole): Promise<TUser | null> => {
  return User.findOne({ partnerId, role } as any).lean();
};

const create = (data: Partial<TUser>, session?: mongoose.ClientSession): Promise<TUser> => {
  if (session) {
    return User.create([data]).then(([doc]) => doc as TUser);
  }
  return User.create(data);
};

const updateById = (id: string, data: Partial<TUser>): Promise<TUser | null> => {
  return User.findByIdAndUpdate(id, data, { new: true }).lean();
};

const findAllByRole = async (
  filter: Record<string, unknown>,
  options: { skip: number; limit: number },
): Promise<TUser[]> => {
  return User.find(filter)
    .populate({
      path: "stationId",
      select: "name stationCode category logo coverImage description website country partner",
      populate: [
        { path: "country", select: "name code" },
        { path: "partner", select: "name" },
      ],
    })
    .populate("partnerId", "name")
    .sort({ createdAt: -1 })
    .skip(options.skip)
    .limit(options.limit)
    .lean();
};

const countByRole = (filter: Record<string, unknown>): Promise<number> => {
  return User.countDocuments(filter);
};

export const UserRepository = {
  findById,
  findByIdWithStation,
  findByAuthId,
  findByPartnerIdAndRole,
  create,
  updateById,
  findAllByRole,
  countByRole,
};
