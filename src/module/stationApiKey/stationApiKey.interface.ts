import { Types } from "mongoose";

export type StationApiKeyType = "sandbox" | "production";

export interface TStationApiKey {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station
  key: string; // generated, unique (hashed for storage)
  name: string; // "Production API" or "Sandbox Test"
  type: StationApiKeyType;
  isActive: boolean;
  lastUsedAt?: Date;
  expiresAt?: Date;

  // Regeneration tracking
  regeneratedAt?: Date;
  regeneratedFrom?: Types.ObjectId; // → StationApiKey (previous key)

  // Stats (denormalized for fast reads)
  totalHits: number; // total API calls made with this key
  avgResponseTimeMs: number; // rolling average response time

  createdAt: Date;
  updatedAt: Date;
}
