import { Document, Types } from "mongoose";

export interface IDeviceSession extends Document {
  userId: Types.ObjectId;
  authId: Types.ObjectId;
  stationId?: Types.ObjectId;
  sessionId: string;
  deviceId: string;
  deviceName: string;
  browser: string;
  os: string;
  ipAddress: string;
  isApprovedStudioDevice: boolean;
  status: "active" | "revoked";
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterSessionInput {
  userId: string;
  authId: string;
  stationId?: string;
  deviceId?: string;
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
}
