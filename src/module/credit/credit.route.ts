import { Router } from "express";
import { CreditController } from "./credit.controller";
import { CreditDto } from "./credit.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";

const router = Router();

// User views own balance, Super/Partner/Customer Care views listener balance (Station Admin excluded)
router.get(
  "/balance",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.CUSTOMER_CARE),
  validateRequest(CreditDto.getBalance),
  CreditController.getBalance,
);

// Super Admin & Partner Admin can grant credits
router.post(
  "/add",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(CreditDto.addCredits),
  CreditController.addCredits,
);

// Super Admin & Partner Admin can deduct credits
router.post(
  "/deduct",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  validateRequest(CreditDto.deductCredits),
  CreditController.deductCredits,
);

// User views own transactions, Admin views scoped transactions
router.get(
  "/transactions",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.STATION_ADMIN),
  CreditController.getTransactions,
);

export const CreditRoutes = router;
