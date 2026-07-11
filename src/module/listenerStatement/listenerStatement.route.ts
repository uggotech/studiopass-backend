import { Router } from "express";
import { ListenerStatementController } from "./listenerStatement.controller";
import { ListenerStatementDto } from "./listenerStatement.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { msisdnMasker } from "../../shared/maskMsisdn";

const router = Router();

// Auto-mask msisdn in responses for presenter/media_station roles
router.use(msisdnMasker);

const allowedRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.STATION_ADMIN,
  UserRole.MEDIA_STATION,
  UserRole.PRESENTER,
  UserRole.CUSTOMER_CARE,
  UserRole.USER,
];

// KPIs must come before /:id to avoid route conflict
router.get("/kpis", auth(...allowedRoles), validateRequest(ListenerStatementDto.getKPIs), ListenerStatementController.getKPIs);

// Export statements (must come before /:id to avoid route conflict)
router.get("/export", auth(...allowedRoles), ListenerStatementController.exportStatements);

// List all statements (role-scoped)
router.get("/", auth(...allowedRoles), validateRequest(ListenerStatementDto.getAllStatements), ListenerStatementController.getAllStatements);

// Get single statement by ID
router.get("/:id", auth(...allowedRoles), validateRequest(ListenerStatementDto.getStatementById), ListenerStatementController.getStatementById);

export const ListenerStatementRoutes = router;
