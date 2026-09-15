import { Types } from "mongoose";

export type TAuditAction =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "PASSWORD_CHANGED"
  | "2FA_ENABLED"
  | "2FA_DISABLED"
  | "2FA_RESET"
  | "SESSION_REVOKED"
  | "SETTINGS_UPDATED";

export type TAuditStatus = "SUCCESS" | "FAILED";

export type TAuditLog = {
  action: TAuditAction;
  status: TAuditStatus;
  userId?: Types.ObjectId;
  authId?: Types.ObjectId;
  usernameOrPhone?: string;
  role?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
};
