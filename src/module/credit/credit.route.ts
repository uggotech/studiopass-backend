import { Router } from "express";
import { CreditController } from "./credit.controller";
import { CreditDto } from "./credit.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// User views own balance, admin views any user's balance
router.get(
  "/balance",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  validateRequest(CreditDto.getBalance),
  CreditController.getBalance,
);

router.post(
  "/add",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(CreditDto.addCredits),
  CreditController.addCredits,
);

// User views own transactions, admin views any user's transactions
router.get(
  "/transactions",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN),
  CreditController.getTransactions,
);

export const CreditRoutes = router;
