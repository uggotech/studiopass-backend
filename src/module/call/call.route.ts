import { Router } from "express";
import { CallController } from "./call.controller";
import { CallDto } from "./call.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { strictLimiter } from "../../middlewares/security";

const router = Router();

// User: request a call to a station
router.post(
  "/request",
  auth(UserRole.USER),
  strictLimiter,
  validateRequest(CallDto.requestCall),
  CallController.requestCall,
);

// Operator: accept an incoming call
router.post(
  "/accept",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  strictLimiter,
  validateRequest(CallDto.acceptCall),
  CallController.acceptCall,
);

// User: confirm joined Agora channel (clears join-confirmation timeout)
router.post(
  "/join",
  auth(UserRole.USER),
  validateRequest(CallDto.joinCall),
  CallController.joinCall,
);

// Either party: end an active call
router.post(
  "/end",
  auth(UserRole.USER, UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  strictLimiter,
  validateRequest(CallDto.endCall),
  CallController.endCall,
);

// User: cancel a queued call
router.post(
  "/cancel",
  auth(UserRole.USER),
  strictLimiter,
  validateRequest(CallDto.cancelCall),
  CallController.cancelCall,
);

// Operator: cut/decline an incoming call
router.post(
  "/reject",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  strictLimiter,
  validateRequest(CallDto.rejectCall),
  CallController.rejectCall,
);

// User: call history
router.get(
  "/history",
  auth(UserRole.USER),
  validateRequest(CallDto.getHistory),
  CallController.getHistory,
);

// Dashboard: station calls
router.get(
  "/station",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(CallDto.getStationCalls),
  CallController.getStationCalls,
);

export const CallRoutes = router;
