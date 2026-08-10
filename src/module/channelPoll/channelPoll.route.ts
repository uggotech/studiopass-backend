import { Router } from "express";
import { ChannelPollController } from "./channelPoll.controller";
import { ChannelPollDto } from "./channelPoll.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// Create a channel poll (station admin, super admin)
router.post(
  "/",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(ChannelPollDto.createPoll),
  ChannelPollController.createPoll,
);

// List all channel polls (admin roles + app users)
router.get(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.USER),
  validateRequest(ChannelPollDto.getAllPolls),
  ChannelPollController.getAllPolls,
);

// Get channel polls for a specific station
router.get(
  "/station/:stationId",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.USER),
  ChannelPollController.getStationPolls,
);

// Get single channel poll
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.USER),
  validateRequest(ChannelPollDto.getPollById),
  ChannelPollController.getPollById,
);

// Vote on a channel poll (app users only)
router.post(
  "/:id/vote",
  auth(UserRole.USER),
  validateRequest(ChannelPollDto.votePoll),
  ChannelPollController.votePoll,
);

// Get channel poll results
router.get(
  "/:id/results",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.USER),
  validateRequest(ChannelPollDto.getPollResults),
  ChannelPollController.getPollResults,
);

// Update channel poll
router.patch(
  "/:id",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(ChannelPollDto.updatePoll),
  ChannelPollController.updatePoll,
);

// Delete channel poll
router.delete(
  "/:id",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(ChannelPollDto.deletePoll),
  ChannelPollController.deletePoll,
);

export const ChannelPollRoutes = router;
