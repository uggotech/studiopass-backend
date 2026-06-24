import express, { Router } from "express";
import { AuthRoutes } from "../module/auth/auth.route";
import { CountryRoutes } from "../module/country/country.route";
import { PartnerRoutes } from "../module/partner/partner.route";
import { StationRoutes } from "../module/station/station.route";
import { UserRoutes } from "../module/user/user.route";
import { LogsRoutes } from "../module/logs/logs.route";
import { FollowRoutes } from "../module/follow/follow.route";
import { ShowRoutes } from "../module/show/show.route";

const router: Router = express.Router();

const apiRoutes = [
  { path: "/auth", route: AuthRoutes },
  { path: "/country", route: CountryRoutes },
  { path: "/partner", route: PartnerRoutes },
  { path: "/station", route: StationRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/show", route: ShowRoutes },
  { path: "/follow", route: FollowRoutes },
  { path: "/logs", route: LogsRoutes },
];

apiRoutes.forEach((route) => router.use(route.path, route.route));

export default router;

