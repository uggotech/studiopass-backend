import { StatusCodes } from "http-status-codes";
import bcrypt from "bcryptjs";
import AppError from "../../errors/AppError";
import { PartnerRepository } from "./partner.repository";
import { AuthRepository } from "../auth/auth.repository";
import { UserRepository } from "../user/user.repository";
import { CountryRepository } from "../country/country.repository";
import { TPartner } from "./partner.interface";
import { UserRole } from "shared/roles";
import { LoginProvider } from "../auth/auth.interface";

const normalizePartner = (p: TPartner) => ({
  id: p._id,
  name: p.name,
  country: p.country,
  contactEmail: p.contactEmail,
  contactPhone: p.contactPhone,
  logo: p.logo,
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const getAllPartners = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = {};

  if (query.isActive !== undefined) {
    filter.status = query.isActive === "true" ? "active" : "inactive";
  }

  if (query.country) {
    filter.country = query.country;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search as string, "i");
    filter.$or = [
      { name: searchRegex },
      { contactEmail: searchRegex },
    ];
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [partners, total] = await Promise.all([
    PartnerRepository.findAll(filter, { skip, limit }),
    PartnerRepository.count(filter),
  ]);

  return {
    partners: partners.map(normalizePartner),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getPartnerById = async (id: string) => {
  const partner = await PartnerRepository.findById(id);
  if (!partner) {
    throw new AppError(StatusCodes.NOT_FOUND, "Partner not found");
  }
  return normalizePartner(partner);
};

const createPartnerWithAdmin = async (data: {
  partnerName: string;
  countryId: string;
  contactEmail?: string;
  contactPhone?: string;
  adminFullName: string;
  adminUsername: string;
  adminPassword: string;
}) => {
  // Validate country exists
  const country = await CountryRepository.findById(data.countryId);
  if (!country) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Country not found");
  }

  // Check partner name uniqueness
  const existingPartner = await PartnerRepository.findByName(data.partnerName);
  if (existingPartner) {
    throw new AppError(StatusCodes.CONFLICT, "Partner with this name already exists");
  }

  // Check username uniqueness
  const existingAuth = await AuthRepository.findByUsername(data.adminUsername);
  if (existingAuth) {
    throw new AppError(StatusCodes.CONFLICT, "Username already taken");
  }

  // Create partner
  const partner = await PartnerRepository.create({
    name: data.partnerName,
    country: country._id,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    status: "active",
  });

  // Create auth for partner admin
  const hashedPassword = await bcrypt.hash(data.adminPassword, 10);
  const authDoc = await AuthRepository.create({
    username: data.adminUsername,
    password: hashedPassword,
    loginProvider: LoginProvider.USERNAME,
    role: UserRole.PARTNER_ADMIN,
    status: "active",
  });

  // Create user profile
  const user = await UserRepository.create({
    auth: authDoc._id,
    fullName: data.adminFullName,
    role: UserRole.PARTNER_ADMIN,
    partnerId: partner._id,
    phone: data.contactPhone,
    profileCompleted: false,
  });

  return {
    partner: normalizePartner(partner),
    admin: {
      id: user._id,
      fullName: user.fullName,
      username: data.adminUsername,
      role: user.role,
    },
  };
};

const updatePartner = async (id: string, data: Partial<TPartner>) => {
  const partner = await PartnerRepository.findById(id);
  if (!partner) {
    throw new AppError(StatusCodes.NOT_FOUND, "Partner not found");
  }

  if (data.name && data.name !== partner.name) {
    const existing = await PartnerRepository.findByName(data.name);
    if (existing) {
      throw new AppError(StatusCodes.CONFLICT, "Partner name already in use");
    }
  }

  const updated = await PartnerRepository.updateById(id, data);
  return normalizePartner(updated!);
};

const deactivatePartner = async (id: string) => {
  const partner = await PartnerRepository.findById(id);
  if (!partner) {
    throw new AppError(StatusCodes.NOT_FOUND, "Partner not found");
  }

  // Deactivate the partner admin's auth account
  const partnerAdmin = await UserRepository.findByPartnerIdAndRole(id, UserRole.PARTNER_ADMIN);
  if (partnerAdmin) {
    await AuthRepository.updateById(partnerAdmin.auth.toString(), { status: "inactive" });
  }

  const updated = await PartnerRepository.updateById(id, { status: "inactive" });
  return normalizePartner(updated!);
};

const reactivatePartner = async (id: string) => {
  const partner = await PartnerRepository.findById(id);
  if (!partner) {
    throw new AppError(StatusCodes.NOT_FOUND, "Partner not found");
  }

  // Reactivate the partner admin's auth account
  const partnerAdmin = await UserRepository.findByPartnerIdAndRole(id, UserRole.PARTNER_ADMIN);
  if (partnerAdmin) {
    await AuthRepository.updateById(partnerAdmin.auth.toString(), { status: "active" });
  }

  const updated = await PartnerRepository.updateById(id, { status: "active" });
  return normalizePartner(updated!);
};

export const PartnerService = {
  getAllPartners,
  getPartnerById,
  createPartnerWithAdmin,
  updatePartner,
  deactivatePartner,
  reactivatePartner,
};
