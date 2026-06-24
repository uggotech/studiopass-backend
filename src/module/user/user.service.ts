import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { UserRepository } from "./user.repository";
import { AuthRepository } from "../auth/auth.repository";
import { StationRepository } from "../station/station.repository";
import { LoginProvider } from "../auth/auth.interface";
import { UserRole } from "shared/roles";
import bcrypt from "bcryptjs";

const normalizeUser = (u: any) => ({
  id: u._id,
  fullName: u.fullName,
  avatar: u.avatar,
  email: u.email,
  phone: u.phone,
  role: u.role,
  stationId: u.stationId,
  partnerId: u.partnerId,
  profileCompleted: u.profileCompleted,
  isBlocked: u.isBlocked,
  isDeleted: u.isDeleted,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const normalizeMediaStation = (u: any) => ({
  id: u._id,
  fullName: u.fullName,
  avatar: u.avatar,
  email: u.email,
  phone: u.phone,
  role: u.role,
  station: u.stationId
    ? {
        id: u.stationId._id,
        name: u.stationId.name,
        stationCode: u.stationId.stationCode,
        category: u.stationId.category,
        country: u.stationId.country,
        partner: u.stationId.partner,
      }
    : null,
  partnerId: u.partnerId,
  profileCompleted: u.profileCompleted,
  isBlocked: u.isBlocked,
  isDeleted: u.isDeleted,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const getAllStationAdmins = async (query: Record<string, unknown>, scope?: { partnerId?: string }) => {
  const filter: Record<string, unknown> = { role: "station_admin" };

  if (scope?.partnerId) {
    filter.partnerId = scope.partnerId;
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.station) {
    filter.stationId = query.station;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { fullName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    UserRepository.findAllByRole(filter, { skip, limit }),
    UserRepository.countByRole(filter),
  ]);

  return {
    users: users.map(normalizeUser),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getUserById = async (id: string) => {
  const user = await UserRepository.findById(id);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }
  return normalizeUser(user);
};

const deactivateUser = async (id: string) => {
  const user = await UserRepository.findById(id);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await UserRepository.updateById(id, { isBlocked: true } as any);
  return normalizeUser(updated!);
};

const reactivateUser = async (id: string) => {
  const user = await UserRepository.findById(id);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await UserRepository.updateById(id, { isBlocked: false } as any);
  return normalizeUser(updated!);
};

const createMediaStation = async (data: {
  fullName: string;
  email?: string;
  phone?: string;
  stationId: string;
  username: string;
  password: string;
}) => {
  // Validate station exists
  const station = await StationRepository.findById(data.stationId);
  if (!station) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station not found");
  }

  // Check username uniqueness
  const existingAuth = await AuthRepository.findByUsername(data.username);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  // Create auth for media station user
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const authDoc = await AuthRepository.create({
    username: data.username,
    password: hashedPassword,
    loginProvider: LoginProvider.USERNAME,
    role: UserRole.MEDIA_STATION,
    status: "active",
  });

  // Create user profile
  const user = await UserRepository.create({
    auth: authDoc._id,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    role: UserRole.MEDIA_STATION,
    stationId: station._id,
    profileCompleted: false,
  });

  return {
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    station: {
      id: station._id,
      name: station.name,
      stationCode: station.stationCode,
    },
  };
};

const getAllMediaStationUsers = async (query: Record<string, unknown>, scope?: { partnerId?: string; stationId?: string }) => {
  const filter: Record<string, unknown> = { role: "media_station" };

  if (scope?.stationId) {
    filter.stationId = scope.stationId;
  } else if (scope?.partnerId) {
    // Get all stations for this partner, then filter users by those stations
    // For now, just filter by partnerId on the user (if populated)
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.station) {
    filter.stationId = query.station;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { fullName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    UserRepository.findAllByRole(filter, { skip, limit }),
    UserRepository.countByRole(filter),
  ]);

  return {
    users: users.map(normalizeMediaStation),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

export const UserService = {
  getAllStationAdmins,
  getUserById,
  deactivateUser,
  reactivateUser,
  createMediaStation,
  getAllMediaStationUsers,
};
