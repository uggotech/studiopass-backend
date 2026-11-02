import { AuditLogService } from "../auditLog/auditLog.service";
import {
  CreditPackageInput,
  createCreditPackage,
  listAllCreditPackages,
  updateCreditPackage,
} from "./payment.packages";
import { PayoutLimits, getPayoutLimits, updatePayoutLimits } from "./payout.settings";

export interface AdminActor {
  authId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

const audit = (actor: AdminActor, reason: string, metadata: Record<string, unknown>) =>
  AuditLogService.logAuthEvent({
    action: "SETTINGS_UPDATED",
    status: "SUCCESS",
    authId: actor.authId as any,
    userId: actor.userId as any,
    role: "super_admin",
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    reason,
    metadata,
  });

const listPackages = () => listAllCreditPackages();

const createPackage = async (input: CreditPackageInput, actor: AdminActor) => {
  const created = await createCreditPackage(input);
  await audit(actor, "Credit package created", { type: "CREDIT_PACKAGE_CREATE", package: created });
  return created;
};

const updatePackage = async (id: string, patch: Partial<CreditPackageInput>, actor: AdminActor) => {
  const updated = await updateCreditPackage(id, patch);
  await audit(actor, "Credit package updated", { type: "CREDIT_PACKAGE_UPDATE", packageId: id, patch });
  return updated;
};

const getLimits = () => getPayoutLimits();

const updateLimits = async (patch: Partial<PayoutLimits>, actor: AdminActor) => {
  const before = await getPayoutLimits();
  const after = await updatePayoutLimits(patch, actor.userId);
  await audit(actor, "Prize payout limits updated", { type: "PAYOUT_LIMITS_UPDATE", before, after });
  return after;
};

export const PaymentAdminService = {
  listPackages,
  createPackage,
  updatePackage,
  getLimits,
  updateLimits,
};
