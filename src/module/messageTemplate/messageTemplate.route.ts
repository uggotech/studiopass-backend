import { Router } from "express";
import { z } from "zod";
import { MessageTemplateController } from "./messageTemplate.controller";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

const stationRoles = [
  UserRole.SUPER_ADMIN,
  UserRole.PARTNER_ADMIN,
  UserRole.STATION_ADMIN,
  UserRole.PRESENTER,
];

router.get(
  "/",
  auth(...stationRoles),
  MessageTemplateController.getTemplates,
);

router.post(
  "/",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(
    z.object({
      body: z.object({
        text: z.string().min(1).max(1600),
      }),
    }),
  ),
  MessageTemplateController.createTemplate,
);

router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  MessageTemplateController.deleteTemplate,
);

router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(
    z.object({
      body: z.object({
        text: z.string().min(1).max(1600),
      }),
    }),
  ),
  MessageTemplateController.updateTemplate,
);

export const MessageTemplateRoutes = router;
