import { Router } from "express";
import { LogsController } from "./logs.controller";
import auth from "../../middlewares/auth";
import { UserRole } from "shared/roles";

const router = Router();

// Protected: super_admin only
router.get("/", auth(UserRole.SUPER_ADMIN), LogsController.getLogs);

router.get(
  "/:category/:fileName",
  auth(UserRole.SUPER_ADMIN),
  LogsController.getLogPreview,
);

// Public: log viewer UI
router.get("/ui", LogsController.getViewer);
router.get("/ui/app.js", LogsController.getViewerScript);

export const LogsRoutes = router;
