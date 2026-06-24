import { Partner } from "./partner.model";
import { TPartner } from "./partner.interface";

const findAll = (
  filter: Record<string, unknown>,
  options: { skip: number; limit: number },
): Promise<TPartner[]> => {
  return Partner.find(filter)
    .populate("country", "name code phoneCode currency currencySymbol")
    .sort({ createdAt: -1 })
    .skip(options.skip)
    .limit(options.limit)
    .lean();
};

const findById = (id: string): Promise<TPartner | null> => {
  return Partner.findById(id)
    .populate("country", "name code phoneCode currency currencySymbol")
    .lean();
};

const findByName = (name: string): Promise<TPartner | null> => {
  return Partner.findOne({ name: new RegExp(`^${name}$`, "i") }).lean();
};

const count = (filter: Record<string, unknown>): Promise<number> => {
  return Partner.countDocuments(filter);
};

const create = (data: Partial<TPartner>): Promise<TPartner> => {
  return Partner.create(data);
};

const updateById = (id: string, data: Partial<TPartner>): Promise<TPartner | null> => {
  return Partner.findByIdAndUpdate(id, data, { new: true })
    .populate("country", "name code phoneCode currency currencySymbol")
    .lean();
};

export const PartnerRepository = {
  findAll,
  findById,
  findByName,
  count,
  create,
  updateById,
};
