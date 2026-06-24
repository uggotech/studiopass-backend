import { Auth } from "./auth.model";
import { TAuth } from "./auth.interface";

const findByPhone = (phone: string): Promise<TAuth | null> => {
  return Auth.findOne({ phone }).select("-password").lean();
};

const findByUsername = (username: string) => {
  return Auth.findOne({ username });
};

const findById = (id: string): Promise<TAuth | null> => {
  return Auth.findById(id).select("-password").lean();
};

const create = (data: Partial<TAuth>): Promise<TAuth> => {
  return Auth.create(data);
};

const updateById = (id: string, data: Partial<TAuth>): Promise<TAuth | null> => {
  return Auth.findByIdAndUpdate(id, data, { new: true }).lean();
};

export const AuthRepository = {
  findByPhone,
  findByUsername,
  findById,
  create,
  updateById,
};
