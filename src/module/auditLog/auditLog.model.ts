import { model, Schema } from "mongoose";
import { TAuditLog } from "./auditLog.interface";

const auditLogSchema = new Schema<TAuditLog>(
  {
    action: {
      type: String,
      enum: [
        "LOGIN_SUCCESS",
        "LOGIN_FAILED",
        "PASSWORD_CHANGED",
        "2FA_ENABLED",
        "2FA_DISABLED",
        "2FA_RESET",
        "SESSION_REVOKED",
        "SETTINGS_UPDATED",
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED"],
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      sparse: true,
      index: true,
    },
    authId: {
      type: Schema.Types.ObjectId,
      ref: "Auth",
      sparse: true,
      index: true,
    },
    usernameOrPhone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    reason: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for fast security querying and incident response
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ authId: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export const AuditLog = model<TAuditLog>("AuditLog", auditLogSchema);
