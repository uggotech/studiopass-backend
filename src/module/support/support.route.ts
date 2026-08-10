import { Router } from "express";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { SupportDto } from "./support.dto";
import { SupportController } from "./support.controller";

import processAndUpload from "../../middlewares/processAndUpload";

const router = Router();

// App Listener endpoints
router.post(
  "/conversations",
  auth(UserRole.USER),
  processAndUpload,
  validateRequest(SupportDto.createConversation),
  SupportController.createConversation,
);

router.get(
  "/conversations/active",
  auth(UserRole.USER),
  SupportController.getActiveUserConversation,
);

// Customer Care Agent / Super Admin Queue & Ticket endpoints
router.get(
  "/conversations/unassigned",
  auth(UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.getUnassignedQueue,
);

router.get(
  "/conversations/my-tickets",
  auth(UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.getMyClaimedTickets,
);

router.get(
  "/conversations/closed",
  auth(UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.getClosedTickets,
);

router.get(
  "/search",
  auth(UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.searchEntities,
);

router.get(
  "/stats",
  auth(UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.getSupportStats,
);

// Conversation Actions
router.get(
  "/conversations/:id/messages",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.getConversationMessages,
);

router.patch(
  "/conversations/:id/claim",
  auth(UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.claimTicket,
);

router.patch(
  "/conversations/:id/close",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  SupportController.closeTicket,
);

router.post(
  "/conversations/:id/messages",
  auth(UserRole.USER, UserRole.SUPER_ADMIN, UserRole.CUSTOMER_CARE, UserRole.PARTNER_ADMIN),
  processAndUpload,
  validateRequest(SupportDto.sendMessage),
  SupportController.sendMessage,
);

export const SupportRoutes = router;
