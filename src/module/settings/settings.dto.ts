import { z } from "zod";

const validRoles = [
  "super_admin",
  "partner_admin",
  "station_admin",
  "media_station",
  "presenter",
  "customer_care",
] as const;

const updateSecuritySettings = z.object({
  body: z.object({
    enforce2FA: z.boolean().optional(),
    enforcedRoles: z.array(z.enum(validRoles)).optional(),
  }),
});

export const SettingsDto = {
  updateSecuritySettings,
};
