import { Router } from "express";
import { StationApiKeyController } from "./stationApiKey.controller";
import { StationApiKeyDto } from "./stationApiKey.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// ─── Dashboard routes (JWT auth) ────────────────────────────────────────────

router.get(
  "/keys",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(StationApiKeyDto.getKeys),
  StationApiKeyController.getKeys,
);

router.post(
  "/keys",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(StationApiKeyDto.createKey),
  StationApiKeyController.createKey,
);

router.patch(
  "/keys/:id/regenerate",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  StationApiKeyController.regenerateKey,
);

router.delete(
  "/keys/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  StationApiKeyController.deactivateKey,
);

router.post(
  "/keys/:id/reveal",
  auth(UserRole.SUPER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(StationApiKeyDto.revealKey),
  StationApiKeyController.revealKey,
);

router.get(
  "/keys/stats",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  StationApiKeyController.getStats,
);

router.get(
  "/keys/logs",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  StationApiKeyController.getLogs,
);

// ─── External TV API (API key auth — NO JWT) ────────────────────────────────

router.get(
  "/messages",
  validateRequest(StationApiKeyDto.getMessages),
  StationApiKeyController.getMessages,
);

export const StationApiKeyRoutes = router;
