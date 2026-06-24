import { model, Schema } from "mongoose";
import { TStationApiKeyLog } from "./stationApiKeyLog.interface";

const stationApiKeyLogSchema = new Schema<TStationApiKeyLog>(
  {
    apiKey: { type: Schema.Types.ObjectId, ref: "StationApiKey", required: true },
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    hitAt: { type: Date, default: Date.now },
    endpoint: { type: String, required: true },
    queryParams: { type: Schema.Types.Mixed },
    responseTimeMs: { type: Number, required: true, min: 0 },
    statusCode: { type: Number, required: true },
    ipAddress: { type: String },
  },
  { timestamps: false },
);

stationApiKeyLogSchema.index({ apiKey: 1, hitAt: -1 });
stationApiKeyLogSchema.index({ station: 1, hitAt: -1 });
stationApiKeyLogSchema.index({ hitAt: 1 }, { expireAfterSeconds: 7776000 }); // TTL: 90 days

export const StationApiKeyLog = model<TStationApiKeyLog>("StationApiKeyLog", stationApiKeyLogSchema);