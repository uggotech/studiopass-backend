import { SettingsRepository } from "./settings.repository";
import { SettingsCache } from "./settings.cacheManage";
import { AuditLogService } from "../auditLog/auditLog.service";

const getSecuritySettings = async () => {
  // Check cache first
  const cached = await SettingsCache.get();
  if (cached) return cached;

  let settings = await SettingsRepository.getSecuritySettings();
  if (!settings) {
    // Initialize default settings
    settings = await SettingsRepository.upsertSecuritySettings({
      enforce2FA: false,
      enforcedRoles: [],
    });
  }

  // Cache for next read
  await SettingsCache.set(settings);
  return settings;
};

const updateSecuritySettings = async (
  data: { enforce2FA?: boolean; enforcedRoles?: string[] },
  adminInfo: { authId: string; ipAddress?: string; userAgent?: string },
) => {
  const settings = await SettingsRepository.upsertSecuritySettings(data);

  // Invalidate cache
  await SettingsCache.invalidate();

  // Audit log
  await AuditLogService.logAuthEvent({
    action: "SETTINGS_UPDATED",
    status: "SUCCESS",
    authId: adminInfo.authId as any,
    ipAddress: adminInfo.ipAddress,
    userAgent: adminInfo.userAgent,
    reason: "Security settings updated",
    metadata: {
      type: "SECURITY_SETTINGS_UPDATE",
      enforce2FA: settings.enforce2FA,
      enforcedRoles: settings.enforcedRoles,
    },
  });

  return settings;
};

export const SettingsService = {
  getSecuritySettings,
  updateSecuritySettings,
};
