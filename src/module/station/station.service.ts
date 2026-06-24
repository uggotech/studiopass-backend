import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import AppError from "../../errors/AppError";
import { StationRepository } from "./station.repository";
import { PartnerRepository } from "../partner/partner.repository";
import { CountryRepository } from "../country/country.repository";
import { AuthRepository } from "../auth/auth.repository";
import { UserRepository } from "../user/user.repository";
import { FollowService } from "../follow/follow.service";
import { TStation } from "./station.interface";
import { UserRole } from "shared/roles";
import { LoginProvider } from "../auth/auth.interface";

const normalizeStation = (s: TStation) => ({
  id: s._id,
  name: s.name,
  stationCode: s.stationCode,
  category: s.category,
  country: s.country,
  partner: s.partner,
  description: s.description,
  logo: s.logo,
  coverImage: s.coverImage,
  website: s.website,
  socialLinks: s.socialLinks,
  isLive: s.isLive,
  isActive: s.isActive,
  isVerified: s.isVerified,
  followersCount: s.followersCount,
  createdBy: s.createdBy,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const getAllStations = async (query: Record<string, unknown>, scope?: { partnerId?: string }) => {
  const filter: Record<string, unknown> = {};

  if (scope?.partnerId) {
    filter.partner = scope.partnerId;
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true";
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.country) {
    filter.country = query.country;
  }

  if (query.partner) {
    filter.partner = query.partner;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { name: searchRegex },
      { stationCode: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [stations, total] = await Promise.all([
    StationRepository.findAll(filter, { skip, limit }),
    StationRepository.count(filter),
  ]);

  return {
    stations: stations.map(normalizeStation),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getStationById = async (id: string) => {
  const station = await StationRepository.findById(id);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }
  return normalizeStation(station);
};

const createStationWithAdmin = async (data: {
  name: string;
  stationCode: string;
  category: string;
  countryId?: string;
  partnerId?: string;
  description?: string;
  website?: string;
  adminFullName: string;
  adminUsername: string;
  adminPassword: string;
}, createdBy?: string) => {
  // Validate partner exists
  if (!data.partnerId) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Partner is required");
  }
  const partner = await PartnerRepository.findById(data.partnerId);
  if (!partner) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Partner not found");
  }

  // Derive country from partner if not provided, otherwise validate the provided country
  let country;
  if (data.countryId) {
    country = await CountryRepository.findById(data.countryId);
    if (!country) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Country not found");
    }
  } else {
    // Derive country from the partner's country field
    const countryIdStr = partner.country?.toString();
    if (!countryIdStr) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Partner has no country assigned");
    }
    country = await CountryRepository.findById(countryIdStr);
    if (!country) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Country not found for this partner");
    }
  }

  // Check station code uniqueness
  const existingStation = await StationRepository.findByStationCode(data.stationCode);
  if (existingStation) {
    throw new AppError(StatusCodes.CONFLICT, "Station with this code already exists");
  }

  // Check username uniqueness
  const existingAuth = await AuthRepository.findByUsername(data.adminUsername);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  // Create station
  const station = await StationRepository.create({
    name: data.name,
    stationCode: data.stationCode.toUpperCase(),
    category: data.category as any,
    country: country._id,
    partner: partner._id,
    description: data.description,
    website: data.website,
    isActive: true,
    isLive: false,
    isVerified: false,
    followersCount: 0,
    createdBy: createdBy ? (createdBy as any) : undefined,
  });

  // Create auth for station admin
  const hashedPassword = await bcrypt.hash(data.adminPassword, 10);
  const authDoc = await AuthRepository.create({
    username: data.adminUsername,
    password: hashedPassword,
    loginProvider: LoginProvider.USERNAME,
    role: UserRole.STATION_ADMIN,
    status: "active",
  });

  // Create user profile
  const user = await UserRepository.create({
    auth: authDoc._id,
    fullName: data.adminFullName,
    role: UserRole.STATION_ADMIN,
    stationId: station._id,
    partnerId: partner._id,
    profileCompleted: false,
  });

  return {
    station: normalizeStation(station),
    admin: {
      id: user._id,
      fullName: user.fullName,
      username: data.adminUsername,
      role: user.role,
    },
  };
};

const updateStation = async (id: string, data: Partial<TStation>) => {
  const station = await StationRepository.findById(id);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  if (data.stationCode && data.stationCode !== station.stationCode) {
    const existing = await StationRepository.findByStationCode(data.stationCode);
    if (existing) {
      throw new AppError(StatusCodes.CONFLICT, "Station code already in use");
    }
  }

  const updated = await StationRepository.updateById(id, data);
  return normalizeStation(updated!);
};

const deactivateStation = async (id: string) => {
  const station = await StationRepository.findById(id);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const updated = await StationRepository.updateById(id, { isActive: false });
  return normalizeStation(updated!);
};

const reactivateStation = async (id: string) => {
  const station = await StationRepository.findById(id);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const updated = await StationRepository.updateById(id, { isActive: true });
  return normalizeStation(updated!);
};

// ─── App Users: Public station listing with follow status ────────────────────

const getPublicStations = async (query: Record<string, unknown>, userId?: string) => {
  const filter: Record<string, unknown> = { isActive: true };

  if (query.category) {
    filter.category = query.category;
  }

  if (query.country) {
    filter.country = query.country;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { name: searchRegex },
      { stationCode: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [stations, total] = await Promise.all([
    StationRepository.findAll(filter, { skip, limit }),
    StationRepository.count(filter),
  ]);

  // Get user's follow status for these stations via FollowService
  const stationIds = stations.map((s) => s._id);
  const followedMap = await FollowService.getFollowStatus(userId, stationIds);

  // Normalize with limited fields + isFollowing
  const normalizedStations = stations.map((s) => ({
    id: s._id,
    name: s.name,
    stationCode: s.stationCode,
    category: s.category,
    logo: s.logo,
    coverImage: s.coverImage,
    country: s.country,
    isLive: s.isLive,
    isVerified: s.isVerified,
    followersCount: s.followersCount,
    isFollowing: followedMap.has(s._id.toString()),
  }));

  return {
    stations: normalizedStations,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

export const StationService = {
  getAllStations,
  getStationById,
  getPublicStations,
  createStationWithAdmin,
  updateStation,
  deactivateStation,
  reactivateStation,
};
