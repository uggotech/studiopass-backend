import { Router } from "express";
import { PrizeTypeController } from "./prizeType.controller";

const router = Router();

router.get("/", PrizeTypeController.getPrizeTypes);

export const PrizeTypeRoutes = router;
