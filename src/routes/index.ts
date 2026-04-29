import express, { Router } from "express";
import AuthRoutes from "../module/auth/auth.route";
import { UserRoutes } from "../module/user/user.route";
import { LogsRoutes } from "../module/logs/logs.route";
import { BroadcastRoutes } from "../module/broadcast/broadcast.route";
import { FollowRoutes } from "../module/follow/follow.route";
import { NotificationRoutes } from "../module/notification/notification.route";

const router: Router = express.Router();

const apiRoutes = [
  { path: "/auth", route: AuthRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/logs", route: LogsRoutes },
  { path: "/broadcast", route: BroadcastRoutes },
  { path: "/follow", route: FollowRoutes },
  { path: "/notification", route: NotificationRoutes },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;

