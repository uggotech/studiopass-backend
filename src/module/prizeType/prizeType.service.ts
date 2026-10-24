import { PrizeTypeRepository } from "./prizeType.repository";
import { TPrizeType } from "./prizeType.interface";
import { logger } from "../../logger/logger";

export const RETIRED_PRIZE_TYPES = ["data_bundles"];

const defaultPrizeTypes: Partial<TPrizeType>[] = [
  { key: "mobile_money", label: "Mobile Money", category: "automated", requiresAmount: true },
  { key: "bonus_credits", label: "Bonus Credits", category: "automated", unit: "Credits", requiresAmount: true },
  { key: "airtime", label: "Airtime", category: "automated", requiresAmount: true },
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
    // Retired prize types (no payout support) stay in the DB for history but can't be picked
    const { PrizeType } = await import("./prizeType.model");
    const retired = await PrizeType.updateMany(
      { key: { $in: RETIRED_PRIZE_TYPES }, isActive: true },
      { $set: { isActive: false } },
    );
    if (retired.modifiedCount) logger.info(`[PrizeType] Deactivated retired prize types: ${RETIRED_PRIZE_TYPES.join(", ")}`);
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
