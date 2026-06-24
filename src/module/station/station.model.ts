import { model, Schema } from "mongoose";
import { TStation } from "./station.interface";

const stationSchema = new Schema<TStation>(
  {
    name: { type: String, required: true, trim: true },
    stationCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    category: { type: String, enum: ["radio", "tv", "channel"], required: true },
    country: { type: Schema.Types.ObjectId, ref: "Country", required: true },
    partner: { type: Schema.Types.ObjectId, ref: "Partner", required: true },
    description: { type: String, trim: true },
    logo: { type: String },
    coverImage: { type: String },
    website: { type: String, trim: true },
    socialLinks: {
      type: {
        facebook: { type: String, trim: true },
        instagram: { type: String, trim: true },
      },
      default: undefined,
    },
    apiKey: { type: String, unique: true, sparse: true }, 
    isLive: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    followersCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

stationSchema.index({ partner: 1 });
stationSchema.index({ country: 1, category: 1, isActive: 1 });
stationSchema.index({ stationCode: 1 }, { unique: true });
stationSchema.index({ apiKey: 1 }, { sparse: true });
stationSchema.index({ followersCount: -1 });

export const Station = model<TStation>("Station", stationSchema);