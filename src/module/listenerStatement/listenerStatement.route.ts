import { Router } from "express";
import { ListenerStatementController } from "./listenerStatement.controller";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";

const router = Router();

const allowedRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.STATION_ADMIN,
  UserRole.USER,
];

// KPIs must come before /:id to avoid route conflict
router.get("/kpis", auth(...allowedRoles), ListenerStatementController.getKPIs);

// List all statements (role-scoped)
router.get("/", auth(...allowedRoles), ListenerStatementController.getAllStatements);

// Get single statement by ID
router.get("/:id", auth(...allowedRoles), ListenerStatementController.getStatementById);

export const ListenerStatementRoutes = router;
