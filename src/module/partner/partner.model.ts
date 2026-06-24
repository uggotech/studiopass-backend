import { model, Schema } from "mongoose";
import { TPartner } from "./partner.interface";

const partnerSchema = new Schema<TPartner>(
  {
    name: { type: String, required: true, trim: true },
    country: { type: Schema.Types.ObjectId, ref: "Country", required: true },
    contactEmail: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    logo: { type: String },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true },
);

partnerSchema.index({ country: 1 });
partnerSchema.index({ status: 1 });

export const Partner = model<TPartner>("Partner", partnerSchema);