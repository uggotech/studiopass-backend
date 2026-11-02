import { model, Schema } from "mongoose";
import { TCountry } from "./country.interface";

const countrySchema = new Schema<TCountry>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    }, // "KE", "UG"
    phoneCode: { type: String, required: true, trim: true }, // "+254"
    currency: { type: String, required: true, trim: true }, // "KES"
    currencySymbol: { type: String, required: true, trim: true }, // "KSh"
    timezone: { type: String, required: true }, // "Africa/Nairobi"
    messageCreditPrice: { type: Number, required: true, min: 0 }, // money value of 1 credit used on a message, e.g. 250 UGX
    callCreditPrice: { type: Number, required: true, min: 0 }, // money value of 1 credit used on a call, e.g. 250 UGX
    smsProviders: { type: [String], default: ["africas_talking"] }, // ["africas_talking"] or ["twilio"]
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

countrySchema.index({ isActive: 1 });
export const Country = model<TCountry>("Country", countrySchema);