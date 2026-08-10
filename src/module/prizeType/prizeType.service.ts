import { PrizeTypeRepository } from "./prizeType.repository";
import { TPrizeType } from "./prizeType.interface";
import { logger } from "../../logger/logger";

const defaultPrizeTypes: Partial<TPrizeType>[] = [
  { key: "mobile_money", label: "Mobile Money", category: "automated", requiresAmount: true },
  { key: "bonus_credits", label: "Bonus Credits", category: "automated", unit: "Credits", requiresAmount: true },
  { key: "airtime", label: "Airtime", category: "automated", requiresAmount: true },
  { key: "data_bundles", label: "Data Bundles", category: "automated", unit: "GB", requiresAmount: true },
  { key: "merchandise_tshirt", label: "T-Shirt", category: "physical", requiresDescription: true, requiresInstructions: true },
  { key: "merchandise_hoodie", label: "Hoodie", category: "physical", requiresDescription: true, requiresInstructions: true },
  { key: "merchandise_cap", label: "Cap", category: "physical", requiresDescription: true, requiresInstructions: true },
  { key: "external_gift", label: "External Gift", category: "physical", requiresDescription: true, requiresSponsor: true, requiresInstructions: true },
  { key: "other", label: "Other", category: "manual", requiresDescription: true, requiresInstructions: true },
];

export const seedPrizeTypes = async (): Promise<void> => {
  try {
    const existingCount = await PrizeTypeRepository.count();
    if (existingCount === 0) {
      await PrizeTypeRepository.createMany(defaultPrizeTypes);
      logger.info("[PrizeType] Default prize types seeded successfully");
    }
  } catch (error) {
    logger.error("[PrizeType] Error seeding prize types:", error);
  }
};

const getAllPrizeTypes = async (): Promise<TPrizeType[]> => {
  return PrizeTypeRepository.findAllActive();
};

export const PrizeTypeService = {
  seedPrizeTypes,
  getAllPrizeTypes,
};
