import { Router } from "express";
import { AuditLogController } from "./auditLog.controller";
import auth from "../../middlewares/auth";
import { UserRole } from "shared/roles";

const router = Router();

// Super Admin: query audit logs
router.get(
  "/",
  auth(UserRole.SUPER_ADMIN),
  AuditLogController.getAuditLogs,
);

export const AuditLogRoutes = router;
