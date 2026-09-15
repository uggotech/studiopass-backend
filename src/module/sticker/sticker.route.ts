import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import auth from "../../middlewares/auth";
import { UserRole } from "shared/roles";
import sendResponse from "../../shared/sendResponse";
import { getStickerLibrary } from "./sticker.service";

const router = Router();

/** Public for any authenticated app/dashboard user */
router.get(
  "/library",
  auth(UserRole.USER, UserRole.MEDIA_STATION, UserRole.PRESENTER, UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.CUSTOMER_CARE),
  (_req, res) => {
    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Sticker library fetched successfully",
      data: getStickerLibrary(),
    });
  },
);

export const StickerRoutes = router;
