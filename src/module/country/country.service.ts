import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CountryRepository } from "./country.repository";
import { TCountry } from "./country.interface";

const normalizeCountry = (c: TCountry) => ({
  id: c._id,
  name: c.name,
  code: c.code,
  phoneCode: c.phoneCode,
  currency: c.currency,
  currencySymbol: c.currencySymbol,
  timezone: c.timezone,
  messageCreditPrice: c.messageCreditPrice,
  callCreditPrice: c.callCreditPrice,
  smsProviders: c.smsProviders,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const getAllCountries = async (query: Record<string, unknown>) => {
  const filter: Record<string, unknown> = { isActive: true };

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive === "true";
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [countries, total] = await Promise.all([
    CountryRepository.findAll(filter, { skip, limit }),
    CountryRepository.count(filter),
  ]);

  return {
    countries: countries.map(normalizeCountry),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getCountryById = async (id: string) => {
  const country = await CountryRepository.findById(id);
  if (!country) {
    throw new AppError(StatusCodes.NOT_FOUND, "Country not found");
  }
  return normalizeCountry(country);
};

const createCountry = async (data: Partial<TCountry>) => {
  const existing = await CountryRepository.findByCode(data.code!);
  if (existing) {
    throw new AppError(StatusCodes.CONFLICT, "Country with this code already exists");
  }

  const country = await CountryRepository.create(data);
  return normalizeCountry(country);
};

const updateCountry = async (id: string, data: Partial<TCountry>) => {
  const country = await CountryRepository.findById(id);
  if (!country) {
    throw new AppError(StatusCodes.NOT_FOUND, "Country not found");
  }

  if (data.code && data.code !== country.code) {
    const existing = await CountryRepository.findByCode(data.code);
    if (existing) {
      throw new AppError(StatusCodes.CONFLICT, "Country code already in use");
    }
  }

  const updated = await CountryRepository.updateById(id, data);
  return normalizeCountry(updated!);
};

const deactivateCountry = async (id: string) => {
  const country = await CountryRepository.findById(id);
  if (!country) {
    throw new AppError(StatusCodes.NOT_FOUND, "Country not found");
  }

  const updated = await CountryRepository.updateById(id, { isActive: false });
  return normalizeCountry(updated!);
};

export const CountryService = {
  getAllCountries,
  getCountryById,
  createCountry,
  updateCountry,
  deactivateCountry,
};
