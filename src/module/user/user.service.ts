import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { UserRepository } from "./user.repository";
import { AuthRepository } from "../auth/auth.repository";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "../show/show.repository";
import { PartnerRepository } from "../partner/partner.repository";
import { MessageRepository } from "../message/message.repository";
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

const getMyProfile = async (userId: string) => {
  const user = await UserRepository.findById(userId);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }
  return {
    id: user._id,
    fullName: user.fullName ?? "",
    avatar: user.avatar ?? null,
    email: user.email ?? null,
    phone: user.phone ?? null,
    phoneCountryCode: user.phoneCountryCode ?? null,
    countryName: user.countryName ?? null,
    countryId: user.countryId?.toString() ?? null,
    role: user.role,
    profileCompleted: user.profileCompleted,
    preferences: user.preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const updateMyProfile = async (
  userId: string,
  data: { fullName?: string; countryId?: string; avatar?: string },
) => {
  const user = await UserRepository.findById(userId);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updateData: Record<string, unknown> = {};
  if (data.fullName !== undefined) updateData.fullName = data.fullName;
  if (data.countryId !== undefined) updateData.countryId = data.countryId;
  if (data.avatar !== undefined) updateData.avatar = data.avatar;

  // Auto-complete profile if user has both name and avatar (from update OR already on user)
  const hasName = data.fullName || user.fullName;
  const hasAvatar = data.avatar || user.avatar;
  if (hasName && hasAvatar) {
    updateData.profileCompleted = true;
  }

  const updated = await UserRepository.updateById(userId, updateData as any);
  return {
    id: updated!._id,
    fullName: updated!.fullName ?? "",
    avatar: updated!.avatar ?? null,
    phone: updated!.phone ?? null,
    phoneCountryCode: updated!.phoneCountryCode ?? null,
    countryName: updated!.countryName ?? null,
    countryId: updated!.countryId?.toString() ?? null,
    role: updated!.role,
    profileCompleted: updated!.profileCompleted,
    preferences: updated!.preferences,
  };
};

const updateFcmToken = async (userId: string, fcmToken: string) => {
  await UserRepository.updateById(userId, { fcmToken } as any);
  return { success: true };
};

const updateMyPreferences = async (
  userId: string,
  data: { theme?: string; language?: string },
) => {
  const user = await UserRepository.findById(userId);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const currentPrefs = user.preferences || { theme: "default", language: "english" };
  const updateData: Record<string, unknown> = {
    preferences: {
      theme: data.theme ?? currentPrefs.theme,
      language: data.language ?? currentPrefs.language,
    },
  };

  const updated = await UserRepository.updateById(userId, updateData as any);
  return {
    id: updated!._id,
    preferences: updated!.preferences,
  };
};

// ─── Presenters ──────────────────────────────────────────────────────────────

const normalizePresenter = (u: any) => ({
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
      }
    : null,
  partnerId: u.partnerId,
  isBlocked: u.isBlocked,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const createPresenter = async (data: {
  fullName: string;
  email?: string;
  phone?: string;
  stationId: string;
  showId?: string;
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

  // Create auth for presenter
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const authDoc = await AuthRepository.create({
    username: data.username,
    password: hashedPassword,
    loginProvider: LoginProvider.USERNAME,
    role: UserRole.PRESENTER,
    status: "active",
  });

  // Create user profile
  const user = await UserRepository.create({
    auth: authDoc._id,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    role: UserRole.PRESENTER,
    stationId: station._id,
    profileCompleted: false,
  });

  // Assign show if provided
  let assignedShow: { id: string; name: string } | null = null;
  if (data.showId) {
    const show = await ShowRepository.findById(data.showId);
    if (show) {
      await ShowRepository.updatePresenter(data.showId, user._id.toString());
      assignedShow = { id: show._id.toString(), name: show.name };
    }
  }

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
    assignedShow,
  };
};

const getAllPresenters = async (query: Record<string, unknown>, scope?: { partnerId?: string; stationId?: string }) => {
  const filter: Record<string, unknown> = { role: "presenter" };

  if (scope?.stationId) {
    filter.stationId = scope.stationId;
  } else if (scope?.partnerId) {
    // For partner admin, we need to filter by stations of that partner
    // The User model doesn't have partnerId for presenters, so we filter via station
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
    users: users.map(normalizePresenter),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

// ─── Listeners (CRM) ────────────────────────────────────────────────────────

const normalizeListener = (u: any) => ({
  id: u._id,
  fullName: u.fullName || "",
  phone: u.phone || "",
  email: u.email || "",
  countryName: u.countryName || "",
  countryId: u.countryId?.toString() || null,
  isBlocked: u.isBlocked,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const getAllListeners = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string },
) => {
  const filter: Record<string, unknown> = { role: "user" };

  // Partner admin: scope by country
  if (scope?.partnerId) {
    const partner = await PartnerRepository.findById(scope.partnerId);
    if (partner?.country) {
      filter.countryId = partner.country;
    }
  }

  // Station admin: scope by station's messaged users
  if (scope?.stationId) {
    const phoneNumbers = await MessageRepository.getListenerPhoneNumbersByStation(scope.stationId);
    if (phoneNumbers.length === 0) {
      return { users: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
    }
    filter.phone = { $in: phoneNumbers };
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.country) {
    filter.countryId = query.country;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { fullName: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
      { countryName: searchRegex },
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
    users: users.map(normalizeListener),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getListenerById = async (id: string) => {
  const user = await UserRepository.findById(id);
  if (!user || user.role !== "user") {
    throw new AppError(StatusCodes.NOT_FOUND, "Listener not found");
  }
  return normalizeListener(user);
};

export const UserService = {
  getAllStationAdmins,
  getUserById,
  deactivateUser,
  reactivateUser,
  createMediaStation,
  getAllMediaStationUsers,
  createPresenter,
  getAllPresenters,
  getAllListeners,
  getListenerById,
  getMyProfile,
  updateMyProfile,
  updateMyPreferences,
  updateFcmToken,
};
