import { Router } from "express";
import auth from "../../middlewares/auth";
import { UserRole } from "../../shared/roles";
import { DashboardController } from "./dashboard.controller";

const router = Router();

const adminRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.STATION_ADMIN,
];

router.get("/stats", auth(...adminRoles), DashboardController.getStats);
router.get("/message-activity", auth(...adminRoles), DashboardController.getMessageActivity);
router.get("/revenue-activity", auth(...adminRoles), DashboardController.getRevenueActivity);
router.get("/listener-activity", auth(...adminRoles), DashboardController.getListenerActivity);
router.get("/campaign-activity", auth(...adminRoles), DashboardController.getCampaignActivity);
router.get("/call-activity", auth(...adminRoles), DashboardController.getCallActivity);
router.get("/campaign-stats", auth(...adminRoles), DashboardController.getCampaignStats);
router.get("/call-operations", auth(...adminRoles), DashboardController.getCallOperationsStats);
router.get("/role-distribution", auth(...adminRoles), DashboardController.getRoleDistribution);
router.get("/station-overview", auth(...adminRoles), DashboardController.getStationOverview);
router.get("/recent-activity", auth(...adminRoles), DashboardController.getRecentActivity);
router.get("/top-stations", auth(...adminRoles), DashboardController.getTopStations);
router.get("/recent-users", auth(...adminRoles), DashboardController.getRecentUsers);
router.get("/credit-stats", auth(...adminRoles), DashboardController.getCreditStats);
router.get("/country-revenue", auth(UserRole.SUPER_ADMIN), DashboardController.getCountryRevenue);

export const DashboardRoutes = router;
