import { model, Schema } from "mongoose";
import { IDeviceSession } from "./device-session.interface";

const deviceSessionSchema = new Schema<IDeviceSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    authId: { type: Schema.Types.ObjectId, ref: "Auth", required: true },
    stationId: { type: Schema.Types.ObjectId, ref: "Station" },
    sessionId: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, index: true },
    deviceName: { type: String, default: "Studio Terminal" },
    browser: { type: String, default: "Unknown Browser" },
    os: { type: String, default: "Unknown OS" },
    ipAddress: { type: String, default: "Unknown IP" },
    isApprovedStudioDevice: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "revoked"], default: "active", index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

deviceSessionSchema.index({ userId: 1, status: 1 });
deviceSessionSchema.index({ deviceId: 1, userId: 1 });
deviceSessionSchema.index({ stationId: 1, isApprovedStudioDevice: 1 });

export const DeviceSession = model<IDeviceSession>("DeviceSession", deviceSessionSchema);
