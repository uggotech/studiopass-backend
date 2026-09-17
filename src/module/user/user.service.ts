import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { UserRepository } from "./user.repository";
import { User } from "./user.model";
import { Auth } from "../auth/auth.model";
import { AuthRepository } from "../auth/auth.repository";
import { StationRepository } from "../station/station.repository";
import { Station } from "../station/station.model";
import { PartnerRepository } from "../partner/partner.repository";
import { MessageRepository } from "../message/message.repository";
import Message from "../message/message.model";
import Call from "../call/call.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import { CreditBalance } from "../creditBalance/creditBalance.model";
import { Country } from "../country/country.model";
import { LoginProvider } from "../auth/auth.interface";
import { UserRole } from "shared/roles";
import bcrypt from "bcryptjs";
import config from "../../config";
import { UserCache } from "./user.cacheManage";
import { CarrierService } from "../../shared/telecom/carrier.service";
import { AuditLogService } from "../auditLog/auditLog.service";

const BCRYPT_SALT_ROUNDS = Number(config.bcrypt_salt_rounds) || 10;

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
        id: u.stationId._id || u.stationId.id,
        name: u.stationId.name,
        stationCode: u.stationId.stationCode,
        category: u.stationId.category,
        logo: u.stationId.logo,
        coverImage: u.stationId.coverImage,
        description: u.stationId.description,
        website: u.stationId.website,
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
    const searchRegex = new RegExp(escapeRegex(query.search as string), "i");
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
  if (user.auth) {
    const authId = user.auth.toString();
    await AuthRepository.updateById(authId, { status: "inactive" });
    await UserCache.invalidateAuthStatus(authId);
  }
  UserCache.invalidateProfile(id);
  return normalizeUser(updated!);
};

const reactivateUser = async (id: string) => {
  const user = await UserRepository.findById(id);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await UserRepository.updateById(id, { isBlocked: false } as any);
  if (user.auth) {
    const authId = user.auth.toString();
    await AuthRepository.updateById(authId, { status: "active" });
    await UserCache.invalidateAuthStatus(authId);
  }
  UserCache.invalidateProfile(id);
  return normalizeUser(updated!);
};

const updateUserById = async (
  id: string,
  data: {
    fullName?: string;
    email?: string;
    phone?: string;
    stationId?: string;
    password?: string;
  },
) => {
  const user = await UserRepository.findById(id);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updateData: Record<string, unknown> = {};
  if (data.fullName !== undefined) updateData.fullName = data.fullName;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.stationId !== undefined) {
    const station = await StationRepository.findById(data.stationId);
    if (!station) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Station not found");
    }
    updateData.stationId = data.stationId;
  }

  const updated = await UserRepository.updateById(id, updateData as any);

  if (data.password && user.auth) {
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);
    await AuthRepository.updatePassword(user.auth.toString(), hashedPassword);
  }

  UserCache.invalidateProfile(id);
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

  // MVP: One media station account per station
  const existingMediaStation = await User.findOne({
    stationId: data.stationId as any,
    role: UserRole.MEDIA_STATION,
    isDeleted: false,
  } as any);
  if (existingMediaStation) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Station already has a Media Station account. Only 1 allowed per station.",
    );
  }

  // Check username uniqueness
  const existingAuth = await AuthRepository.usernameExists(data.username);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  // Use transaction for atomicity: auth + user
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create auth for media station user
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);
    const authDocs = await AuthRepository.create({
      username: data.username,
      password: hashedPassword,
      loginProvider: LoginProvider.USERNAME,
      role: UserRole.MEDIA_STATION,
      status: "active",
    }, session);
    const authDoc = Array.isArray(authDocs) ? authDocs[0] : authDocs;

    // Create user profile
    const users = await UserRepository.create({
      auth: authDoc._id,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      role: UserRole.MEDIA_STATION,
      stationId: station._id,
      partnerId: (station.partner as any)?._id || station.partner,
      profileCompleted: false,
    }, session);
    const user = Array.isArray(users) ? users[0] : users;

    await session.commitTransaction();

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
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getAllMediaStationUsers = async (query: Record<string, unknown>, scope?: { partnerId?: string; stationId?: string }) => {
  const filter: Record<string, unknown> = { role: "media_station" };

  if (scope?.stationId) {
    filter.stationId = scope.stationId;
  } else if (scope?.partnerId) {
    const partnerStations = await Station.find({ partner: scope.partnerId }).select("_id").lean();
    const stationIds = partnerStations.map((s) => s._id);
    filter.$or = [
      { partnerId: scope.partnerId },
      { stationId: { $in: stationIds } },
    ];
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.station) {
    filter.stationId = query.station;
  }

  if (query.search) {
    const searchRegex = new RegExp(escapeRegex(query.search as string), "i");
    filter.$or = [
      { fullName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const baseFilterWithoutStatus = { ...filter };
  delete baseFilterWithoutStatus.isBlocked;

  const [users, total, activeTotal, inactiveTotal] = await Promise.all([
    UserRepository.findAllByRole(filter, { skip, limit }),
    UserRepository.countByRole(filter),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: false }),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: true }),
  ]);

  return {
    users: users.map(normalizeMediaStation),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), activeTotal, inactiveTotal },
  };
};

/**
 * Resolve IANA timezone from a country id or populated country doc.
 * Returns null when unknown — never invent "UTC" when lookup failed.
 */
async function resolveTimezoneFromCountryId(countryRef: unknown): Promise<string | null> {
  if (!countryRef) return null;

  if (typeof countryRef === "object" && countryRef !== null) {
    if ("timezone" in (countryRef as any) && (countryRef as any).timezone) {
      return (countryRef as any).timezone as string;
    }
    const id = (countryRef as any)._id ?? (countryRef as any).id;
    if (!id) return null;
    try {
      const country = await Country.findById(id).select("timezone").lean();
      return (country as any)?.timezone || null;
    } catch {
      return null;
    }
  }

  try {
    const country = await Country.findById(countryRef).select("timezone").lean();
    return (country as any)?.timezone || null;
  } catch {
    return null;
  }
}

/**
 * Prefer station country (station-scoped roles), then partner country, then user country.
 */
async function resolveDashboardTimezone(
  user: any,
  station: any,
  partner?: any,
): Promise<string | null> {
  // 1) Station → country → timezone (media_station, presenter, station_admin)
  const stationCountry = station?.country ?? null;
  if (stationCountry) {
    const tz =
      typeof stationCountry === "object" && stationCountry.timezone
        ? stationCountry.timezone
        : await resolveTimezoneFromCountryId(stationCountry);
    if (tz) return tz;
  }

  // 2) Station id present but country not populated — reload station.country
  const stationId = station?._id || user?.stationId;
  if (stationId && !stationCountry) {
    try {
      const { Station } = await import("../station/station.model");
      const stationDoc = await Station.findById(stationId).select("country").lean();
      const tz = await resolveTimezoneFromCountryId((stationDoc as any)?.country);
      if (tz) return tz;
    } catch {
      // ignore
    }
  }

  // 3) Partner → country (partner_admin, customer_care)
  const partnerCountry = partner?.country ?? null;
  if (partnerCountry) {
    const tz =
      typeof partnerCountry === "object" && partnerCountry.timezone
        ? partnerCountry.timezone
        : await resolveTimezoneFromCountryId(partnerCountry);
    if (tz) return tz;
  }

  const partnerId = partner?._id || user?.partnerId;
  if (partnerId && !partnerCountry) {
    try {
      const { Partner } = await import("../partner/partner.model");
      const partnerDoc = await Partner.findById(partnerId).select("country").lean();
      const tz = await resolveTimezoneFromCountryId((partnerDoc as any)?.country);
      if (tz) return tz;
    } catch {
      // ignore
    }
  }

  // 4) User.countryId (app users / customer care fallback)
  if (user?.countryId) {
    const tz = await resolveTimezoneFromCountryId(user.countryId);
    if (tz) return tz;
  }

  return null;
}

const getMyProfile = async (userId: string) => {
  const user = await UserRepository.findByIdWithStation(userId);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }
  const station: any = (user.stationId && typeof user.stationId === "object" && "name" in user.stationId) ? user.stationId : null;
  const partner: any = (user.partnerId && typeof user.partnerId === "object" && "name" in user.partnerId) ? user.partnerId : null;

  // null when unresolved — frontend merges with login/Redux timezone
  const timezone = await resolveDashboardTimezone(user, station, partner);

  let twoFactorEnabled = false;
  if (user.auth) {
    const authDoc = await Auth.findById(user.auth).select("twoFactorEnabled").lean();
    twoFactorEnabled = !!authDoc?.twoFactorEnabled;
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
    timezone,
    role: user.role,
    twoFactorEnabled,
    stationId: station?._id?.toString() || user.stationId?.toString() || null,
    stationName: station?.name || null,
    stationLogo: station?.logo || null,
    stationCategory: station?.category || "radio",
    channelType: station?.channelType || null,
    station: station
      ? {
          id: station._id.toString(),
          name: station.name,
          stationCode: station.stationCode,
          category: station.category,
          channelType: station.channelType || null,
          logo: station.logo || null,
          coverImage: station.coverImage || null,
          country: station.country
            ? typeof station.country === "object"
              ? {
                  id: (station.country as any)._id?.toString?.() ?? null,
                  name: (station.country as any).name ?? null,
                  timezone: (station.country as any).timezone ?? null,
                }
              : station.country.toString()
            : null,
        }
      : null,
    profileCompleted: user.profileCompleted,
    preferences: user.preferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const updateMyProfile = async (
  userId: string,
  data: { fullName?: string; email?: string; phone?: string; countryId?: string; avatar?: string },
) => {
  const user = await UserRepository.findById(userId);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updateData: Record<string, unknown> = {};
  if (data.fullName !== undefined) updateData.fullName = data.fullName;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.countryId !== undefined) updateData.countryId = data.countryId;
  if (data.avatar !== undefined) updateData.avatar = data.avatar;

  // Auto-complete profile if user has both name and avatar (from update OR already on user)
  const hasName = data.fullName || user.fullName;
  const hasAvatar = data.avatar || user.avatar;
  if (hasName && hasAvatar) {
    updateData.profileCompleted = true;
  }

  const updated = await UserRepository.updateById(userId, updateData as any);

  // Invalidate cache
  UserCache.invalidateProfile(userId);

  let timezone = "UTC";
  const effectiveCountryId = updated?.countryId || user.countryId;
  if (effectiveCountryId) {
    const country = await Country.findById(effectiveCountryId).select("timezone").lean();
    if (country?.timezone) timezone = country.timezone;
  }

  return {
    id: updated!._id,
    fullName: updated!.fullName ?? "",
    email: updated!.email ?? "",
    avatar: updated!.avatar ?? null,
    phone: updated!.phone ?? null,
    phoneCountryCode: updated!.phoneCountryCode ?? null,
    countryName: updated!.countryName ?? null,
    countryId: updated!.countryId?.toString() ?? null,
    timezone,
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
  UserCache.invalidateProfile(userId);
  return {
    id: updated!._id,
    preferences: updated!.preferences,
  };
};

// ─── Presenters ──────────────────────────────────────────────────────────────

const normalizePresenter = (u: any) => ({
  id: u._id,
  fullName: u.fullName,
  username: (u.auth as any)?.username || u.username || "",
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
  username: string;
  password: string;
}) => {
  // Validate station exists
  const station = await StationRepository.findById(data.stationId);
  if (!station) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station not found");
  }

  // Check username uniqueness
  const existingAuth = await AuthRepository.usernameExists(data.username);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  // Use transaction for atomicity: auth + user
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create auth for presenter
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);
    const authDocs = await AuthRepository.create({
      username: data.username,
      password: hashedPassword,
      loginProvider: LoginProvider.USERNAME,
      role: UserRole.PRESENTER,
      status: "active",
    }, session);
    const authDoc = Array.isArray(authDocs) ? authDocs[0] : authDocs;

    // Create user profile
    const users = await UserRepository.create({
      auth: authDoc._id,
      fullName: data.fullName,
      username: data.username,
      email: data.email,
      phone: data.phone,
      role: UserRole.PRESENTER,
      stationId: station._id,
      partnerId: (station.partner as any)?._id || station.partner,
      profileCompleted: false,
    }, session);
    const user = Array.isArray(users) ? users[0] : users;

    await session.commitTransaction();

    return {
      id: user._id,
      fullName: user.fullName,
      username: data.username,
      email: user.email,
      role: user.role,
      station: {
        id: station._id,
        name: station.name,
        stationCode: station.stationCode,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getAllPresenters = async (query: Record<string, unknown>, scope?: { partnerId?: string; stationId?: string }) => {
  const filter: Record<string, unknown> = { role: "presenter" };

  if (scope?.stationId) {
    filter.stationId = scope.stationId;
  } else if (scope?.partnerId) {
    const partnerStations = await Station.find({ partner: scope.partnerId }).select("_id").lean();
    const stationIds = partnerStations.map((s) => s._id);
    filter.$or = [
      { partnerId: scope.partnerId },
      { stationId: { $in: stationIds } },
    ];
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.station) {
    filter.stationId = query.station;
  }

  if (query.search) {
    const searchRegex = new RegExp(escapeRegex(query.search as string), "i");
    filter.$or = [
      { fullName: searchRegex },
      { username: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const baseFilterWithoutStatus = { ...filter };
  delete baseFilterWithoutStatus.isBlocked;

  const [users, total, activeTotal, inactiveTotal] = await Promise.all([
    UserRepository.findAllByRole(filter, { skip, limit }),
    UserRepository.countByRole(filter),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: false }),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: true }),
  ]);

  return {
    users: users.map(normalizePresenter),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), activeTotal, inactiveTotal },
  };
};

// ─── Listeners (CRM) ────────────────────────────────────────────────────────

const normalizeListener = (u: any) => ({
  id: u._id,
  fullName: u.fullName || "",
  phone: u.phone || "",
  operator: CarrierService.detectOperator(u.phone, u.countryName || u.phoneCountryCode || "UG"),
  email: u.email || "",
  avatar: u.avatar || null,
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
      filter.countryId = (partner.country as any)?._id || partner.country;
    }
  }

  // Station admin: scope by station's messaged users or poll voters
  if (scope?.stationId) {
    const { Station } = await import("../station/station.model");
    const station = await Station.findById(scope.stationId).select("category channelType").lean();
    if (station?.category === "channel" && station?.channelType === "polls") {
      const { ChannelPoll, ChannelPollVote } = await import("../channelPoll/channelPoll.model");
      const polls = await ChannelPoll.find({ station: scope.stationId }).select("_id").lean();
      const pollIds = polls.map((p: any) => p._id);
      const voterUserIds = await ChannelPollVote.find({ poll: { $in: pollIds } }).distinct("user");
      if (voterUserIds.length === 0) {
        return { users: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0, activeTotal: 0, inactiveTotal: 0 } };
      }
      filter._id = { $in: voterUserIds };
    } else {
      const phoneNumbers = await MessageRepository.getListenerPhoneNumbersByStation(scope.stationId);
      if (phoneNumbers.length === 0) {
        return { users: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0, activeTotal: 0, inactiveTotal: 0 } };
      }
      filter.phone = { $in: phoneNumbers };
    }
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.country) {
    filter.countryId = query.country;
  }

  if (query.search) {
    const searchRegex = new RegExp(escapeRegex(query.search as string), "i");
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

  const baseFilterWithoutStatus = { ...filter };
  delete baseFilterWithoutStatus.isBlocked;

  const [users, total, activeTotal, inactiveTotal] = await Promise.all([
    UserRepository.findAllByRole(filter, { skip, limit }),
    UserRepository.countByRole(filter),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: false }),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: true }),
  ]);

  const listenerIds = users.map((u: any) => u._id);
  const listenerPhones = users.map((u: any) => u.phone).filter(Boolean);

  const { ChannelPollVote } = await import("../channelPoll/channelPoll.model");

  const [messageCounts, callCounts, voteCounts, creditBalances] = await Promise.all([
    Message.aggregate([
      { $match: { $or: [{ user: { $in: listenerIds } }, { msisdn: { $in: listenerPhones } }], senderType: "user" } },
      { $group: { _id: { $ifNull: ["$user", "$msisdn"] }, count: { $sum: 1 } } },
    ]),
    Call.aggregate([
      { $match: { startedBy: { $in: listenerIds } } },
      { $group: { _id: "$startedBy", count: { $sum: 1 } } },
    ]),
    ChannelPollVote.aggregate([
      { $match: { user: { $in: listenerIds } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
    CreditBalance.find({ user: { $in: listenerIds } }).select("user balance").lean(),
  ]);

  const msgMap = new Map<string, number>();
  messageCounts.forEach((m: any) => {
    if (m._id) msgMap.set(m._id.toString(), m.count);
  });
  const callMap = new Map<string, number>();
  callCounts.forEach((c: any) => {
    if (c._id) callMap.set(c._id.toString(), c.count);
  });
  const voteMap = new Map<string, number>();
  voteCounts.forEach((v: any) => {
    if (v._id) voteMap.set(v._id.toString(), v.count);
  });
  const balanceMap = new Map<string, number>();
  creditBalances.forEach((b: any) => {
    if (b.user) balanceMap.set(b.user.toString(), b.balance ?? 0);
  });

  const normalized = users.map((u: any) => ({
    ...normalizeListener(u),
    messageCount: msgMap.get(u._id.toString()) || msgMap.get(u.phone) || 0,
    callCount: callMap.get(u._id.toString()) || 0,
    voteCount: voteMap.get(u._id.toString()) || 0,
    creditBalance: balanceMap.get(u._id.toString()) || 0,
    balance: balanceMap.get(u._id.toString()) || 0,
  }));

  return {
    users: normalized,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), activeTotal, inactiveTotal },
  };
};

const getListenerById = async (id: string, callerRole?: string) => {
  const user = await UserRepository.findById(id);
  if (!user || user.role !== "user") {
    throw new AppError(StatusCodes.NOT_FOUND, "Listener not found");
  }

  const userIdObj = new mongoose.Types.ObjectId(id);

  let currency = "UGX";
  let currencySymbol = "UGX";

  if (callerRole === "super_admin") {
    currency = "UGX";
    currencySymbol = "UGX";
  } else if (user.countryId) {
    const countryDoc = await Country.findById(user.countryId).lean();
    if (countryDoc) {
      currency = countryDoc.currency || "UGX";
      currencySymbol = countryDoc.currencySymbol || countryDoc.currency || "UGX";
    }
  } else if (user.countryName) {
    const countryDoc = await Country.findOne({ name: user.countryName }).lean();
    if (countryDoc) {
      currency = countryDoc.currency || "UGX";
      currencySymbol = countryDoc.currencySymbol || countryDoc.currency || "UGX";
    }
  }

  const messageFilter: Record<string, unknown> = {
    senderType: "user",
    isDeleted: { $ne: true },
    ...(user.phone
      ? { $or: [{ user: userIdObj }, { msisdn: user.phone }] }
      : { user: userIdObj }),
  };

  const callFilter: Record<string, unknown> = {
    $or: [{ startedBy: userIdObj }, { user: userIdObj }],
  };

  const { ChannelPollVote } = await import("../channelPoll/channelPoll.model");

  const [totalMessages, totalCalls, totalVotes, spendResult, balanceDoc] = await Promise.all([
    Message.countDocuments(messageFilter),
    Call.countDocuments(callFilter),
    ChannelPollVote.countDocuments({ user: userIdObj }),
    CreditTransaction.aggregate([
      {
        $match: {
          user: userIdObj,
          type: "purchase",
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          totalLocalSpend: { $sum: { $ifNull: ["$localAmount", 0] } },
          totalCreditsPurchased: { $sum: "$amount" },
        },
      },
    ]),
    CreditBalance.findOne({ user: userIdObj }).lean(),
  ]);

  let totalSpend = 0;
  if (spendResult.length > 0) {
    if (callerRole === "super_admin") {
      totalSpend = spendResult[0].totalCreditsPurchased * 500;
    } else {
      totalSpend = spendResult[0].totalLocalSpend > 0
        ? spendResult[0].totalLocalSpend
        : spendResult[0].totalCreditsPurchased;
    }
  }

  return {
    ...normalizeListener(user),
    balance: balanceDoc?.balance ?? 0,
    creditBalance: balanceDoc?.balance ?? 0,
    freeBalance: balanceDoc?.freeBalance ?? 0,
    paidBalance: balanceDoc?.paidBalance ?? 0,
    totalMessages,
    totalCalls,
    totalVotes,
    totalSpend,
    currency,
    currencySymbol,
  };
};

const getListenerVotes = async (userId: string) => {
  const { ChannelPollVote } = await import("../channelPoll/channelPoll.model");
  const votes = await ChannelPollVote.find({ user: userId })
    .populate("poll", "title billingMode creditCost categories")
    .sort({ createdAt: -1 })
    .lean();

  return votes.map((v: any) => {
    const poll = v.poll || {};
    const categories = poll.categories || [];
    const category = categories[v.categoryIndex];
    const nominee = category?.nominees?.[v.nomineeIndex];
    return {
      id: v._id.toString(),
      pollId: poll._id ? poll._id.toString() : "",
      pollTitle: poll.title || "Channel Poll",
      categoryName: category?.name || "Category",
      nomineeName: nominee?.name || "Nominee",
      creditCost: poll.billingMode === "credits" ? (poll.creditCost || 0) : 0,
      createdAt: v.createdAt,
    };
  });
};

const getAllCustomerCareUsers = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; countryId?: string },
) => {
  const filter: Record<string, unknown> = { role: UserRole.CUSTOMER_CARE };

  if (scope?.countryId) {
    filter.country = scope.countryId;
  }
  if (scope?.partnerId) {
    filter.partnerId = scope.partnerId;
  }

  if (query.isActive !== undefined) {
    filter.isBlocked = query.isActive === "false";
  }

  if (query.country) {
    filter.country = query.country;
  }

  if (query.search) {
    const searchRegex = new RegExp(escapeRegex(query.search as string), "i");
    filter.$or = [
      { fullName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const baseFilterWithoutStatus = { ...filter };
  delete baseFilterWithoutStatus.isBlocked;

  const [users, total, activeTotal, inactiveTotal] = await Promise.all([
    UserRepository.findAllByRole(filter, { skip, limit }),
    UserRepository.countByRole(filter),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: false }),
    UserRepository.countByRole({ ...baseFilterWithoutStatus, isBlocked: true }),
  ]);

  return {
    users: users.map(normalizeUser),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), activeTotal, inactiveTotal },
  };
};

/**
 * Top fans — real engagement data.
 * When scope.stationId is set (media station / station staff), only that station's
 * messages + calls are counted. Call user field is `startedBy`, not `user`.
 */
const buildTopFanFromUser = (
  u: any,
  messages: number,
  calls: number,
  rank: number,
  extra?: Record<string, unknown>,
) => ({
  id: u._id.toString(),
  name: u.fullName || "Anonymous Fan",
  phone: u.phone || "N/A",
  status: u.isBlocked ? "Inactive" : "Active",
  messages,
  calls,
  polls: Math.floor(messages / 3),
  score: messages * 2 + calls * 5,
  joinedDate: u.createdAt ? new Date(u.createdAt).toISOString().split("T")[0] : "2026-01-01",
  lastActive: u.updatedAt ? new Date(u.updatedAt).toISOString() : new Date().toISOString(),
  rank,
  ...extra,
});

const getTopFans = async (scope?: { stationId?: string }) => {
  const stationOid =
    scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)
      ? new mongoose.Types.ObjectId(scope.stationId)
      : null;

  const msgMatch: Record<string, unknown> = { senderType: "user", user: { $ne: null } };
  const callMatch: Record<string, unknown> = { startedBy: { $ne: null } };
  if (stationOid) {
    msgMatch.station = stationOid;
    callMatch.station = stationOid;
  }

  const [messageCounts, callCounts] = await Promise.all([
    Message.aggregate([
      { $match: msgMatch },
      { $group: { _id: "$user", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
    Call.aggregate([
      { $match: callMatch },
      { $group: { _id: "$startedBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
  ]);

  const msgMap = new Map(messageCounts.map((m: any) => [m._id?.toString(), m.count || 0]));
  const callMap = new Map(callCounts.map((c: any) => [c._id?.toString(), c.count || 0]));
  const userIds = [
    ...new Set([
      ...[...msgMap.keys()].filter(Boolean),
      ...[...callMap.keys()].filter(Boolean),
    ]),
  ].map((id) => id as string);

  // Station-scoped: only listeners with real activity at this station
  if (stationOid) {
    if (userIds.length === 0) return [];
    const users = await User.find({
      _id: { $in: userIds },
      role: UserRole.USER,
      isDeleted: { $ne: true },
    }).lean();

    return users
      .map((u) => {
        const key = u._id.toString();
        return buildTopFanFromUser(u, msgMap.get(key) || 0, callMap.get(key) || 0, 0);
      })
      .sort((a, b) => b.score - a.score || b.messages - a.messages)
      .map((fan, index) => ({ ...fan, rank: index + 1 }))
      .slice(0, 20);
  }

  // Global (super/partner): rank by real activity first
  if (userIds.length > 0) {
    const users = await User.find({
      _id: { $in: userIds },
      role: UserRole.USER,
      isDeleted: { $ne: true },
    }).lean();

    const ranked = users
      .map((u) => {
        const key = u._id.toString();
        return buildTopFanFromUser(u, msgMap.get(key) || 0, callMap.get(key) || 0, 0);
      })
      .sort((a, b) => b.score - a.score || b.messages - a.messages)
      .map((fan, index) => ({ ...fan, rank: index + 1 }))
      .slice(0, 20);

    if (ranked.length > 0) return ranked;
  }

  // Fallback global: recent listeners with zero engagement (still real users)
  const users = await User.find({ role: UserRole.USER, isDeleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return users.map((u, index) => buildTopFanFromUser(u, 0, 0, index + 1));
};

/**
 * Single top-fan detail for dashboard (station-scoped for media station).
 */
const getTopFanById = async (fanUserId: string, scope?: { stationId?: string }) => {
  if (!mongoose.Types.ObjectId.isValid(fanUserId)) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Invalid fan id");
  }

  const user = await User.findOne({
    _id: fanUserId,
    role: UserRole.USER,
    isDeleted: { $ne: true },
  }).lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "Fan not found");
  }

  const stationOid =
    scope?.stationId && mongoose.Types.ObjectId.isValid(scope.stationId)
      ? new mongoose.Types.ObjectId(scope.stationId)
      : null;

  const msgFilter: Record<string, unknown> = { user: fanUserId, senderType: "user" };
  const callFilter: Record<string, unknown> = { startedBy: fanUserId };
  if (stationOid) {
    msgFilter.station = stationOid;
    callFilter.station = stationOid;
  }

  const [messages, calls, recentMessages, recentCalls] = await Promise.all([
    Message.countDocuments(msgFilter),
    Call.countDocuments(callFilter),
    Message.find(msgFilter)
      .sort({ createdAt: -1 })
      .limit(8)
      .populate("show", "name")
      .lean(),
    Call.find(callFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("show", "name")
      .lean(),
  ]);

  // Rank among top fans for the same scope
  const list = await getTopFans(scope);
  const fromList = list.find((f) => f.id === user._id.toString());
  const rank = fromList?.rank ?? 0;
  const polls = fromList?.polls ?? Math.floor(messages / 3);

  // Favourite show = most frequent show on this fan's messages
  const showCounts = new Map<string, number>();
  for (const m of recentMessages as any[]) {
    const showName = m?.show?.name;
    if (showName) showCounts.set(showName, (showCounts.get(showName) || 0) + 1);
  }
  // Prefer aggregate over recent sample when possible
  const showAgg = await Message.aggregate([
    { $match: msgFilter },
    { $group: { _id: "$show", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);
  let favouriteShow = "General Program";
  if (showAgg[0]?._id) {
    const { Show } = await import("../show/show.model");
    const showDoc = await Show.findById(showAgg[0]._id).select("name").lean();
    favouriteShow = (showDoc as any)?.name || favouriteShow;
  } else if (showCounts.size > 0) {
    const topEntry = [...showCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topEntry?.[0]) favouriteShow = topEntry[0];
  }

  const recentActivity: { action: string; time: string; icon: string }[] = [];
  for (const m of recentMessages.slice(0, 5) as any[]) {
    const showName = m?.show?.name ? ` · ${m.show.name}` : "";
    const preview = (m.content || (m.mediaType && m.mediaType !== "text" ? `[${m.mediaType}]` : "Message")).slice(0, 40);
    recentActivity.push({
      action: `Sent message${showName}: ${preview}`,
      time: m.createdAt ? new Date(m.createdAt).toISOString() : "",
      icon: "message",
    });
  }
  for (const c of recentCalls.slice(0, 3) as any[]) {
    recentActivity.push({
      action: `Call ${c.status || "placed"}`,
      time: c.createdAt ? new Date(c.createdAt).toISOString() : "",
      icon: "call",
    });
  }

  return {
    id: user._id.toString(),
    name: user.fullName || "Anonymous Fan",
    phone: user.phone || "N/A",
    status: user.isBlocked ? "Inactive" : "Active",
    messages,
    calls,
    polls,
    rank,
    score: messages * 2 + calls * 5,
    favouriteShow,
    joinedDate: user.createdAt
      ? new Date(user.createdAt).toISOString().split("T")[0]
      : "2026-01-01",
    lastActive: user.updatedAt
      ? new Date(user.updatedAt).toISOString()
      : new Date().toISOString(),
    recentActivity,
  };
};

const createCustomerCareUser = async (data: {
  fullName: string;
  username: string;
  email?: string;
  phone?: string;
  password: string;
  scopeType: "global" | "country";
  countryId?: string;
}) => {
  const existingAuth = await AuthRepository.usernameExists(data.username);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  let countryObj: any = null;
  if (data.scopeType === "country") {
    if (!data.countryId) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Country ID is required for country-wise Customer Care");
    }
    countryObj = await Country.findById(data.countryId);
    if (!countryObj) {
      throw new AppError(StatusCodes.NOT_FOUND, "Country not found");
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    const authDocs = await AuthRepository.create(
      {
        username: data.username,
        phone: data.phone,
        password: hashedPassword,
        loginProvider: LoginProvider.USERNAME,
        role: UserRole.CUSTOMER_CARE,
        status: "active",
      },
      session,
    );
    const authDoc = Array.isArray(authDocs) ? authDocs[0] : authDocs;

    const users = await UserRepository.create(
      {
        auth: authDoc._id,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        role: UserRole.CUSTOMER_CARE,
        scopeType: data.scopeType,
        countryId: countryObj ? countryObj._id : undefined,
        countryName: countryObj ? countryObj.name : undefined,
        profileCompleted: true,
      },
      session,
    );
    const user = Array.isArray(users) ? users[0] : users;

    await session.commitTransaction();

    return {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      scopeType: user.scopeType,
      countryId: user.countryId,
      countryName: user.countryName,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const resetUser2FA = async (
  targetUserId: string,
  adminInfo: { authId: string; ipAddress?: string; userAgent?: string },
) => {
  // Self-reset guard
  if (targetUserId === adminInfo.authId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You cannot reset your own 2FA via administrative override.");
  }

  let user: any = null;

  // 1. Direct User lookup by ID
  try {
    user = await UserRepository.findById(targetUserId);
  } catch {}

  // 2. Lookup by Auth ID in User collection
  if (!user) {
    try {
      user = await UserRepository.findByAuthId(targetUserId);
    } catch {}
  }

  // 3. Lookup partner_admin user by Partner ID
  if (!user) {
    try {
      user = await User.findOne({ partnerId: targetUserId, role: UserRole.PARTNER_ADMIN });
    } catch {}
  }

  // 4. Lookup station_admin user by Station ID
  if (!user) {
    try {
      user = await User.findOne({ stationId: targetUserId, role: UserRole.STATION_ADMIN });
    } catch {}
  }

  let authId: string | undefined;

  if (user) {
    authId = user.auth?._id?.toString() || user.auth?.toString() || user.id?.toString() || user._id?.toString();
  } else {
    // 5. Fallback: check if targetUserId directly matches an Auth document
    try {
      const directAuth = await Auth.findById(targetUserId);
      if (directAuth) {
        authId = directAuth._id.toString();
      }
    } catch {}
  }

  if (!authId) {
    throw new AppError(StatusCodes.NOT_FOUND, "User or associated authentication account not found");
  }

  await Auth.findByIdAndUpdate(authId, {
    $set: {
      twoFactorEnabled: false,
      twoFactorResetRequired: true,
    },
    $unset: {
      twoFactorSecret: 1,
      twoFactorTempSecret: 1,
    },
  });

  await AuditLogService.logAuthEvent({
    action: "2FA_RESET",
    status: "SUCCESS",
    userId: user?._id,
    authId: authId as any,
    usernameOrPhone: user?.phone || user?.username,
    role: user?.role,
    ipAddress: adminInfo.ipAddress,
    userAgent: adminInfo.userAgent,
    reason: "Super Admin reset Two-Factor Authentication — user must reconfigure on next login",
    metadata: { targetUserId, adminAuthId: adminInfo.authId, forcedReSetup: true },
  });

  return {
    message: `Two-Factor Authentication has been reset for ${user?.fullName || "the account"}.`,
  };
};

export const UserService = {
  getAllStationAdmins,
  getUserById,
  updateUserById,
  deactivateUser,
  reactivateUser,
  createMediaStation,
  getAllMediaStationUsers,
  createPresenter,
  getAllPresenters,
  createCustomerCareUser,
  getAllCustomerCareUsers,
  getAllListeners,
  getListenerById,
  getListenerVotes,
  getTopFans,
  getTopFanById,
  getMyProfile,
  updateMyProfile,
  updateMyPreferences,
  updateFcmToken,
  resetUser2FA,
};
