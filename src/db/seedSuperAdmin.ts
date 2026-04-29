import config from "config";
import { Auth } from "module/auth/auth.model";
import { User } from "module/user/user.model";
import { logger } from "../logger/logger";
import { LoginProvider, UserRole } from "module/auth/auth.interface";

const SUPER_ADMIN_PHONE = (config.super_admin as { phone: string }).phone || "+254000000000";

const seedSuperAdmin = async () => {
  // Find by designated phone number
  const existing = await Auth.findOne({ phone: SUPER_ADMIN_PHONE }).select("_id phone isPhoneVerified");

  if (existing) {
    // Ensure flags are correct even if manually altered
    await Auth.updateOne(
      { _id: existing._id },
      { $set: { role: UserRole.ADMIN, status: "active", isPhoneVerified: true } },
    );

    const profile = await User.findOne({ auth: existing._id }).select("_id role");
    if (!profile) {
      await User.create({
        auth: existing._id,
        fullName: "Super Admin",
        phone: existing.phone ?? SUPER_ADMIN_PHONE,
        role: UserRole.ADMIN,
        profileCompleted: false,
      });
      logger.info("[seed] User profile created for existing super admin");
    } else if (profile.role !== UserRole.ADMIN) {
      await User.updateOne({ _id: profile._id }, { $set: { role: UserRole.ADMIN } });
      logger.info("[seed] User profile role updated to admin");
    }

    logger.info("[seed] Super admin already exists — flags refreshed");
    return;
  }

  // Create fresh super admin
  const authDoc = await Auth.create({
    phone: SUPER_ADMIN_PHONE,
    loginProvider: LoginProvider.PHONE,
    isPhoneVerified: true,
    role: UserRole.ADMIN,
    status: "active",
  });

  await User.create({
    auth: authDoc._id,
    phone: SUPER_ADMIN_PHONE,
    fullName: "Super Admin",
    role: UserRole.ADMIN,
    profileCompleted: false,
  });

  logger.info(`[seed] Super admin seeded with phone ${SUPER_ADMIN_PHONE}`);
};

export default seedSuperAdmin;

