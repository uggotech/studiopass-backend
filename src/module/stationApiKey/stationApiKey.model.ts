import { model, Schema } from "mongoose";
import { TStationApiKey } from "./stationApiKey.interface";

const stationApiKeySchema = new Schema<TStationApiKey>(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["sandbox", "production"], required: true },
    isActive: { type: Boolean, default: true },
    lastUsedAt: { type: Date },
    expiresAt: { type: Date },
    regeneratedAt: { type: Date },
    regeneratedFrom: { type: Schema.Types.ObjectId, ref: "StationApiKey" },
    totalHits: { type: Number, default: 0, min: 0 },
    avgResponseTimeMs: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

stationApiKeySchema.index({ key: 1 });
stationApiKeySchema.index({ station: 1, type: 1, isActive: 1 });
stationApiKeySchema.index({ station: 1, isActive: 1 });

export const StationApiKey = model<TStationApiKey>("StationApiKey", stationApiKeySchema);