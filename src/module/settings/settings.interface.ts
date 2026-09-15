export interface TSecuritySettings {
  _id: string; // Fixed: "security" singleton
  enforce2FA: boolean;
  enforcedRoles: string[];
  updatedAt: Date;
  createdAt: Date;
}
