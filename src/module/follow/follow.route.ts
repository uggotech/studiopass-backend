import { Router } from "express";
import { FollowController } from "./follow.controller";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";

const router = Router();

// App users: toggle follow/unfollow station
router.post("/:stationId/toggle", auth(UserRole.USER), FollowController.toggleFollow);

export const FollowRoutes = router;
