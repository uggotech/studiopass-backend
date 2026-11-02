import { Schema, model, Types } from "mongoose";

export interface TCreditPackage {
  _id: Types.ObjectId;
  label: string;        // e.g. "Starter"
  amountUgx: number;    // price in UGX (whole number)
  credits: number;      // credits granted on a successful payment (whole number)
  isActive: boolean;    // inactive packages are hidden from the app but kept for history
  sortOrder: number;    // lower first; ties are ordered by price
  createdAt: Date;
  updatedAt: Date;
}

const isWholeNumber = (v: number) => Number.isInteger(v);

const creditPackageSchema = new Schema<TCreditPackage>(
  {
    label: { type: String, required: true, trim: true, maxlength: 40 },
    amountUgx: {
      type: Number,
      required: true,
      min: [100, "Price must be at least UGX 100"],
      max: [2_000_000, "Price cannot exceed UGX 2,000,000"],
      validate: { validator: isWholeNumber, message: "Price must be a whole number" },
    },
    credits: {
      type: Number,
      required: true,
      min: [1, "Credits must be at least 1"],
      max: [100_000, "Credits cannot exceed 100,000"],
      validate: { validator: isWholeNumber, message: "Credits must be a whole number" },
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

creditPackageSchema.index({ isActive: 1, sortOrder: 1, amountUgx: 1 });

export const CreditPackage = model<TCreditPackage>("CreditPackage", creditPackageSchema);
