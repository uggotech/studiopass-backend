import { Country } from "./country.model";
import { TCountry } from "./country.interface";

const findAll = (
  filter: Record<string, unknown>,
  options: { skip: number; limit: number },
): Promise<TCountry[]> => {
  return Country.find(filter).sort({ name: 1 }).skip(options.skip).limit(options.limit).lean();
};

const findById = (id: string): Promise<TCountry | null> => {
  return Country.findById(id).lean();
};

const findByCode = (code: string): Promise<TCountry | null> => {
  return Country.findOne({ code: code.toUpperCase() }).lean();
};

const findByName = (name: string): Promise<TCountry | null> => {
  return Country.findOne({ name: new RegExp(`^${name.trim()}$`, "i") }).lean();
};

const count = (filter: Record<string, unknown>): Promise<number> => {
  return Country.countDocuments(filter);
};

const create = (data: Partial<TCountry>): Promise<TCountry> => {
  return Country.create(data);
};

const updateById = (id: string, data: Partial<TCountry>): Promise<TCountry | null> => {
  return Country.findByIdAndUpdate(id, data, { new: true }).lean();
};

export const CountryRepository = {
  findAll,
  findById,
  findByCode,
  findByName,
  count,
  create,
  updateById,
};
