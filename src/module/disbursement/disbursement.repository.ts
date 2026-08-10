import { Disbursement } from "./disbursement.model";
import { TDisbursement } from "./disbursement.interface";

const create = (data: Partial<TDisbursement>): Promise<TDisbursement> => {
  return Disbursement.create(data);
};

const findWithPagination = (
  filter: Record<string, unknown>,
  options: { skip?: number; limit?: number } = {},
): Promise<TDisbursement[]> => {
  const query = Disbursement.find(filter)
    .populate("challenge", "title name")
    .populate("station", "name category")
    .populate("winnerUser", "fullName phone avatar")
    .sort({ createdAt: -1 });

  if (options.skip) query.skip(options.skip);
  if (options.limit) query.limit(options.limit);

  return query.lean() as unknown as Promise<TDisbursement[]>;
};

const count = (filter: Record<string, unknown>): Promise<number> => {
  return Disbursement.countDocuments(filter);
};

const findById = (id: string): Promise<TDisbursement | null> => {
  return Disbursement.findById(id).lean() as unknown as Promise<TDisbursement | null>;
};

const updateStatus = (
  id: string,
  data: { status: string; txRef?: string; failureReason?: string; processedAt?: Date },
): Promise<TDisbursement | null> => {
  return Disbursement.findByIdAndUpdate(id, data, { new: true }).lean() as unknown as Promise<TDisbursement | null>;
};

export const DisbursementRepository = {
  create,
  findWithPagination,
  count,
  findById,
  updateStatus,
};
