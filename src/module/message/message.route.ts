import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { MessageController } from "./message.controller";
import { MessageDto } from "./message.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import processAndUpload from "../../middlewares/processAndUpload";
import sendResponse from "../../shared/sendResponse";

const router = Router();

router.post(
  "/",
  auth(UserRole.USER),
  validateRequest(MessageDto.sendMessage),
  MessageController.sendMessage,
);

router.post(
  "/upload-image",
  auth(UserRole.USER),
  processAndUpload,
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
  validateRequest(MessageDto.sendReply),
  MessageController.sendStationReply,
);

router.get(
  "/thread",
  auth(UserRole.USER),
  validateRequest(MessageDto.getThread),
  MessageController.getThread,
);

router.get(
  "/threads",
  auth(UserRole.MEDIA_STATION, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  MessageController.getThreads,
);

export const MessageRoutes = router;
