import { Router } from "express";
import { ChallengeController } from "./challenge.controller";
import { ChallengeDto } from "./challenge.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// Create a challenge (partner admin, super admin)
router.post(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(ChallengeDto.createChallenge),
  ChallengeController.createChallenge,
);

// List all challenges (admin roles + app users)
router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.USER),
  validateRequest(ChallengeDto.getAllChallenges),
  ChallengeController.getAllChallenges,
);

// Get challenges for a specific station
router.get(
  "/station/:stationId",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.USER),
  ChallengeController.getStationChallenges,
);

// Get single challenge
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.USER),
  validateRequest(ChallengeDto.getChallengeById),
  ChallengeController.getChallengeById,
);

// Get admin leaderboard with phone & payout status
router.get(
  "/:id/leaderboard-admin",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  ChallengeController.getAdminLeaderboard,
);

// Participate in a challenge (app users only)
router.post(
  "/:id/participate",
  auth(UserRole.USER),
  validateRequest(ChallengeDto.participateInChallenge),
  ChallengeController.participateInChallenge,
);

// Get challenge result (app users)
router.get(
  "/:id/result",
  auth(UserRole.USER),
  ChallengeController.getChallengeResult,
);

// Cancel challenge
router.patch(
  "/:id/cancel",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  ChallengeController.cancelChallenge,
);

// Update challenge
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(ChallengeDto.updateChallenge),
  ChallengeController.updateChallenge,
);

// Delete challenge
router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(ChallengeDto.deleteChallenge),
  ChallengeController.deleteChallenge,
);

export const ChallengeRoutes = router;
