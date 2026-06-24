import { User } from "./user.model";
import { TUser } from "./user.interface";
import { UserRole } from "shared/roles";

const findById = (id: string): Promise<TUser | null> => {
  return User.findById(id).lean();
};

const findByAuthId = (authId: string): Promise<TUser | null> => {
  return User.findOne({ auth: authId }).lean();
};

const findByPartnerIdAndRole = (partnerId: string, role: UserRole): Promise<TUser | null> => {
  return User.findOne({ partnerId, role } as any).lean();
};

const create = (data: Partial<TUser>): Promise<TUser> => {
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
    .populate("stationId", "name stationCode category")
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
  findByAuthId,
  findByPartnerIdAndRole,
  create,
  updateById,
  findAllByRole,
  countByRole,
};
