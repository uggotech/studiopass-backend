import { Auth } from "module/auth/auth.model";
import { User } from "module/user/user.model";
import { logger } from "../logger/logger";
import { UserRole } from "shared/roles";
import { LoginProvider } from "module/auth/auth.interface";
import config from "config";
import bcrypt from "bcryptjs";

const SUPER_ADMIN_PHONE = (config.super_admin as { phone: string }).phone || "+254000000000";
const SUPER_ADMIN_USERNAME = "superadmin";
const SUPER_ADMIN_PASSWORD = (config.super_admin as { password: string }).password || "Admin@123";

const seedSuperAdmin = async () => {
  // Check if super admin username auth exists
  const existing = await Auth.findOne({ username: SUPER_ADMIN_USERNAME }).select("_id username phone");

  if (existing) {
    // Ensure password is set (fixes records created before password field was added)
    const needsPassword = !(await Auth.findOne({ _id: existing._id, password: { $exists: true, $type: "string" } }).select("_id"));
    const updateFields: Record<string, unknown> = { role: UserRole.SUPER_ADMIN, status: "active" };
    if (needsPassword) {
      updateFields.password = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
    }
    await Auth.updateOne({ _id: existing._id }, { $set: updateFields });

    const profile = await User.findOne({ auth: existing._id }).select("_id role");
    if (!profile) {
      await User.create({
        auth: existing._id,
        fullName: "Super Admin",
        phone: existing.phone ?? SUPER_ADMIN_PHONE,
        role: UserRole.SUPER_ADMIN,
        profileCompleted: false,
      });
      logger.info("[seed] User profile created for existing super admin");
    } else if (profile.role !== UserRole.SUPER_ADMIN) {
      await User.updateOne({ _id: profile._id }, { $set: { role: UserRole.SUPER_ADMIN } });
      logger.info("[seed] User profile role updated to super_admin");
    }

    logger.info("[seed] Super admin already exists — flags refreshed");
    return;
  }

  // Migrate: if phone-only super admin exists, add username+password
  const phoneAdmin = await Auth.findOne({ phone: SUPER_ADMIN_PHONE, role: UserRole.SUPER_ADMIN }).select("_id phone username");
  if (phoneAdmin) {
    const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
    await Auth.updateOne(
      { _id: phoneAdmin._id },
      { $set: { username: SUPER_ADMIN_USERNAME, password: hashedPassword, loginProvider: LoginProvider.USERNAME } },
    );
    logger.info(`[seed] Migrated super admin to username login: ${SUPER_ADMIN_USERNAME}`);
    return;
  }

  // Create super admin with username + password (dashboard login)
  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);

  const authDoc = await Auth.create({
    username: SUPER_ADMIN_USERNAME,
    password: hashedPassword,
    phone: SUPER_ADMIN_PHONE,
    loginProvider: LoginProvider.USERNAME,
    isPhoneVerified: true,
    role: UserRole.SUPER_ADMIN,
    status: "active",
  });

  await User.create({
    auth: authDoc._id,
    phone: SUPER_ADMIN_PHONE,
    fullName: "Super Admin",
    role: UserRole.SUPER_ADMIN,
    profileCompleted: false,
  });

  logger.info(`[seed] Super admin seeded — username: ${SUPER_ADMIN_USERNAME}`);
};

export default seedSuperAdmin;
