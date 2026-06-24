import { Router } from "express";
import { z } from "zod";
import { MessageTemplateController } from "./messageTemplate.controller";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

router.get(
  "/",
  auth(UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.PRESENTER),
  MessageTemplateController.getTemplates,
);

router.post(
  "/",
  auth(UserRole.STATION_ADMIN),
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
  auth(UserRole.STATION_ADMIN),
  MessageTemplateController.deleteTemplate,
);

export const MessageTemplateRoutes = router;
