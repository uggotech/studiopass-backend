import { Schema, model } from "mongoose";
import { TPrizeType } from "./prizeType.interface";

const prizeTypeSchema = new Schema<TPrizeType>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    label: { type: String, required: true, trim: true },
    category: { type: String, enum: ["automated", "physical", "manual"], required: true },
    unit: { type: String, trim: true },
    requiresAmount: { type: Boolean, default: false },
    requiresDescription: { type: Boolean, default: false },
    requiresSponsor: { type: Boolean, default: false },
    requiresInstructions: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

prizeTypeSchema.index({ key: 1 });
prizeTypeSchema.index({ isActive: 1 });

export const PrizeType = model<TPrizeType>("PrizeType", prizeTypeSchema);
