import { AuditLog } from "./auditLog.model";
import { TAuditLog } from "./auditLog.interface";
import { logger } from "../../logger/logger";

const logAuthEvent = async (data: Partial<TAuditLog>): Promise<void> => {
  try {
    await AuditLog.create(data);
  } catch (error) {
    // Audit log failure should NEVER throw an error or crash the auth request
    logger.error("[AuditLog] Failed to record authentication audit log:", error);
  }
};

const getAuditLogs = async (
  filter: { action?: string; authId?: string; userId?: string },
  page: number = 1,
  limit: number = 20,
) => {
  const query: Record<string, any> = {};
  if (filter.action) query.action = filter.action;
  if (filter.authId) query.authId = filter.authId;
  if (filter.userId) query.userId = filter.userId;

  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    AuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(query),
  ]);

  return {
    logs,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

export const AuditLogService = {
  logAuthEvent,
  getAuditLogs,
};
