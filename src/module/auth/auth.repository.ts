import mongoose from "mongoose";
import { Auth } from "./auth.model";
import { TAuth } from "./auth.interface";

const findByPhone = (phone: string): Promise<TAuth | null> => {
  return Auth.findOne({ phone }).select("-password").lean();
};

const findByUsername = (username: string) => {
  return Auth.findOne({ username });
};

const usernameExists = (username: string) => {
  return Auth.findOne({ username }).select("_id").lean();
};

const findById = (id: string): Promise<TAuth | null> => {
  return Auth.findById(id).select("-password").lean();
};

const findByIdWithPassword = (id: string) => {
  return Auth.findById(id).lean();
};

const create = (data: Partial<TAuth>, session?: mongoose.ClientSession): Promise<TAuth> => {
  if (session) {
    return Auth.create([data]).then(([doc]) => doc as TAuth);
  }
  return Auth.create(data);
};

const updateById = (id: string, data: Partial<TAuth>): Promise<TAuth | null> => {
  return Auth.findByIdAndUpdate(id, data, { new: true }).lean();
};

const updatePassword = (id: string, passwordHash: string) => {
  return Auth.findByIdAndUpdate(id, { password: passwordHash }, { new: true }).lean();
};

export const AuthRepository = {
  findByPhone,
  findByUsername,
  usernameExists,
  findById,
  findByIdWithPassword,
  create,
  updateById,
  updatePassword,
};
