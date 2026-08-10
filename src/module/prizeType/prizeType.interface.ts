import { Types } from "mongoose";

export type PrizeCategory = "automated" | "physical" | "manual";

export interface TPrizeType {
  _id: Types.ObjectId;
  key: string;
  label: string;
  category: PrizeCategory;
  unit?: string;
  requiresAmount: boolean;
  requiresDescription: boolean;
  requiresSponsor: boolean;
  requiresInstructions: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
