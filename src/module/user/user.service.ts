import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { UserRepository } from "./user.repository";
import { User } from "./user.model";
import { Auth } from "../auth/auth.model";
import { AuthRepository } from "../auth/auth.repository";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "../show/show.repository";
import { PartnerRepository } from "../partner/partner.repository";
import { MessageRepository } from "../message/message.repository";
import Message from "../message/message.model";
import Call from "../call/call.model";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import { Country } from "../country/country.model";
import { LoginProvider } from "../auth/auth.interface";
import { UserRole } from "shared/roles";
import bcrypt from "bcryptjs";
import { UserCache } from "./user.cacheManage";

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
    await AuthRepository.updateById(user.auth.toString(), { status: "inactive" });
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
    await AuthRepository.updateById(user.auth.toString(), { status: "active" });
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
    const hashedPassword = await bcrypt.hash(data.password, 10);
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
    const hashedPassword = await bcrypt.hash(data.password, 10);
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

const getMyProfile = async (userId: string) => {
  const user = await UserRepository.findByIdWithStation(userId);
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }
  const station: any = (user.stationId && typeof user.stationId === "object" && "name" in user.stationId) ? user.stationId : null;

  let timezone = "UTC";
  if (user.countryId) {
    const country = await Country.findById(user.countryId).select("timezone").lean();
    if (country?.timezone) timezone = country.timezone;
  } else if (station?.country) {
    const countryId = (station.country as any)?._id || station.country;
    const country = await Country.findById(countryId).select("timezone").lean();
    if (country?.timezone) timezone = country.timezone;
  }

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
  const existingAuth = await AuthRepository.usernameExists(data.username);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  // Use transaction for atomicity: auth + user (+ optional show update)
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create auth for presenter
    const hashedPassword = await bcrypt.hash(data.password, 10);
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
      email: data.email,
      phone: data.phone,
      role: UserRole.PRESENTER,
      stationId: station._id,
      profileCompleted: false,
    }, session);
    const user = Array.isArray(users) ? users[0] : users;

    // Assign show if provided
    let assignedShow: { id: string; name: string } | null = null;
    if (data.showId) {
      const show = await ShowRepository.findById(data.showId);
      if (show) {
        await ShowRepository.updatePresenter(data.showId, user._id.toString());
        assignedShow = { id: show._id.toString(), name: show.name };
      }
    }

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
      assignedShow,
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
    users: users.map(normalizePresenter),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit), activeTotal, inactiveTotal },
  };
};

// ─── Listeners (CRM) ────────────────────────────────────────────────────────

const normalizeListener = (u: any) => ({
  id: u._id,
  fullName: u.fullName || "",
  phone: u.phone || "",
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

  const [messageCounts, callCounts, voteCounts] = await Promise.all([
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

  const normalized = users.map((u: any) => ({
    ...normalizeListener(u),
    messageCount: msgMap.get(u._id.toString()) || msgMap.get(u.phone) || 0,
    callCount: callMap.get(u._id.toString()) || 0,
    voteCount: voteMap.get(u._id.toString()) || 0,
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

  const [totalMessages, totalCalls, totalVotes, spendResult] = await Promise.all([
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

const getTopFans = async (_scope?: { stationId?: string }) => {
  const users = await User.find({ role: UserRole.USER })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const userIds = users.map((u) => u._id);

  const [messageCounts, callCounts] = await Promise.all([
    Message.aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
    Call.aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
  ]);

  const msgMap = new Map(messageCounts.map((m) => [m._id.toString(), m.count]));
  const callMap = new Map(callCounts.map((c) => [c._id.toString(), c.count]));

  const topFans = users
    .map((u) => {
      const messages = msgMap.get(u._id.toString()) || 0;
      const calls = callMap.get(u._id.toString()) || 0;
      return {
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
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((fan, index) => ({
      ...fan,
      rank: index + 1,
    }));

  return topFans;
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
    const hashedPassword = await bcrypt.hash(data.password, 10);

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

const resetUser2FA = async (targetUserId: string) => {
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
      twoFactorRecoveryCodes: [],
    },
    $unset: {
      twoFactorSecret: 1,
      twoFactorTempSecret: 1,
    },
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
  getMyProfile,
  updateMyProfile,
  updateMyPreferences,
  updateFcmToken,
  resetUser2FA,
};
