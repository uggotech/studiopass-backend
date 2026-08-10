import { PrizeType } from "./prizeType.model";
import { TPrizeType } from "./prizeType.interface";

const findAllActive = (): Promise<TPrizeType[]> => {
  return PrizeType.find({ isActive: true }).sort({ category: 1, label: 1 }).lean();
};

const findByKey = (key: string): Promise<TPrizeType | null> => {
  return PrizeType.findOne({ key, isActive: true }).lean();
};

const count = (): Promise<number> => {
  return PrizeType.countDocuments();
};

const createMany = (data: Partial<TPrizeType>[]): Promise<TPrizeType[]> => {
  return PrizeType.insertMany(data) as unknown as Promise<TPrizeType[]>;
};

export const PrizeTypeRepository = {
  findAllActive,
  findByKey,
  count,
  createMany,
};
