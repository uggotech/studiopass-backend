import { Types } from "mongoose";

export interface TStationApiKeyLog {
  _id: Types.ObjectId;
  apiKey: Types.ObjectId; // → StationApiKey
  station: Types.ObjectId; // → Station (denormalized for fast queries)
  hitAt: Date;
  endpoint: string; // "/api/v1/station-api/messages"
  queryParams?: Record<string, unknown>; // { limit: 20, show: "Morning Drive" }
  responseTimeMs: number; // how long the request took
  statusCode: number; // 200, 400, 401, 500, etc.
  ipAddress?: string; // caller's IP (for abuse detection)
}

