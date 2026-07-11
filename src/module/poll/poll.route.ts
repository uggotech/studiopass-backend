import { Router } from "express";
import { PollController } from "./poll.controller";
import { PollDto } from "./poll.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// Create a poll (station admin, media station, super admin)
router.post(
  "/",
  auth(UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.SUPER_ADMIN),
  validateRequest(PollDto.createPoll),
  PollController.createPoll,
);

// List all polls (admin roles + app users)
router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.USER),
  validateRequest(PollDto.getAllPolls),
  PollController.getAllPolls,
);

// Get polls for a specific station
router.get(
  "/station/:stationId",
  auth(UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.SUPER_ADMIN, UserRole.USER),
  PollController.getStationPolls,
);

// Get single poll
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.USER),
  validateRequest(PollDto.getPollById),
  PollController.getPollById,
);

// Vote on a poll (listeners)
router.post(
  "/:id/vote",
  auth(UserRole.USER),
  validateRequest(PollDto.votePoll),
  PollController.votePoll,
);

// Update poll
router.patch(
  "/:id",
  auth(UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.SUPER_ADMIN),
  validateRequest(PollDto.updatePoll),
  PollController.updatePoll,
);

// Delete poll
router.delete(
  "/:id",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(PollDto.deletePoll),
  PollController.deletePoll,
);

export const PollRoutes = router;
