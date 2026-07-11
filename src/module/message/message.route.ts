import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { MessageController } from "./message.controller";
import { MessageDto } from "./message.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import processAndUpload from "../../middlewares/processAndUpload";
import sendResponse from "../../shared/sendResponse";
import { strictLimiter } from "../../middlewares/security";
import { msisdnMasker } from "../../shared/maskMsisdn";

const router = Router();

// Auto-mask msisdn in responses for presenter/media_station roles
router.use(msisdnMasker);

router.post(
  "/",
  auth(UserRole.USER),
  strictLimiter,
  validateRequest(MessageDto.sendMessage),
  MessageController.sendMessage,
);

router.post(
  "/upload-image",
  auth(UserRole.USER),
  processAndUpload,
  validateRequest(MessageDto.uploadImage),
  async (req, res) => {
    const imageUrl = (req.body as any).image;
    if (!imageUrl) {
      sendResponse(res, {
        success: false,
        statusCode: StatusCodes.BAD_REQUEST,
        message: "No image uploaded",
      });
      return;
    }
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Image uploaded successfully",
      data: { imageUrl },
    });
  },
);

router.post(
  "/reply",
  auth(UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN),
  strictLimiter,
  validateRequest(MessageDto.sendReply),
  MessageController.sendStationReply,
);

// Static routes MUST be before /:id to avoid "threads" being cast as ObjectId
router.get(
  "/threads",
  auth(UserRole.USER, UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(MessageDto.getThreads),
  MessageController.getThreads,
);

router.get(
  "/thread",
  auth(UserRole.USER, UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(MessageDto.getThread),
  MessageController.getThread,
);

router.get(
  "/search",
  auth(UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  MessageController.searchMessages,
);

router.get(
  "/export",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  MessageController.exportMessages,
);

router.get(
  "/pending",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(MessageDto.getPendingMessages),
  MessageController.getPendingMessages,
);

router.get(
  "/list",
  auth(UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  MessageController.getList,
);

// Dynamic routes AFTER static paths
router.get(
  "/:id",
  auth(UserRole.USER, UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN),
  MessageController.getMessageById,
);

router.patch(
  "/:id/approve",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(MessageDto.approveMessage),
  MessageController.approveMessage,
);

router.patch(
  "/:id/reject",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(MessageDto.rejectMessage),
  MessageController.rejectMessage,
);

router.patch(
  "/:id/send-to-output",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(MessageDto.sendToOutput),
  MessageController.sendToOutput,
);

router.delete(
  "/:id",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  MessageController.deleteMessage,
);

router.patch(
  "/:id/read",
  auth(UserRole.USER, UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  MessageController.markAsRead,
);

export const MessageRoutes = router;
