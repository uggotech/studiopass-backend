import { Settings } from "./settings.model";
import { TSecuritySettings } from "./settings.interface";

const getSecuritySettings = async (): Promise<TSecuritySettings | null> => {
  return Settings.findOne({ _id: "security" }).lean();
};

const upsertSecuritySettings = async (
  data: Partial<Pick<TSecuritySettings, "enforce2FA" | "enforcedRoles">>,
): Promise<TSecuritySettings> => {
  return Settings.findOneAndUpdate(
    { _id: "security" },
    { $set: data },
    { upsert: true, new: true, runValidators: true },
  ).lean();
};

export const SettingsRepository = {
  getSecuritySettings,
  upsertSecuritySettings,
};
