import { Router } from "express";
import { StatusController } from "./status.controller";
import { StatusDto } from "./status.dto";
import { UserRole } from "shared/roles";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import processAndUpload from "../../middlewares/processAndUpload";
import sendResponse from "../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";

const router = Router();

// Create a manual status post (station admin, super admin)
router.post(
  "/",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(StatusDto.createStatus),
  StatusController.createStatus,
);

const handleUploadMedia = async (req: any, res: any) => {
  const media = (req.body as any).image || (req.body as any).optionImage;
  if (!media) {
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
    message: "Media uploaded successfully",
    data: { media, optionImage: media },
  });
};

// Upload status media image / option image
router.post(
  "/upload-media",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.MEDIA_STATION, UserRole.PRESENTER),
  processAndUpload,
  handleUploadMedia,
);

router.post(
  "/upload",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.MEDIA_STATION, UserRole.PRESENTER),
  processAndUpload,
  handleUploadMedia,
);

// Manually trigger weekly top fans generation (super admin only)
router.post(
  "/generate-weekly",
  auth(UserRole.SUPER_ADMIN),
  validateRequest(StatusDto.generateWeeklyTopFans),
  StatusController.generateWeeklyTopFans,
);

// App feed — stations with active statuses for a country (must be before /:id)
router.get(
  "/feed",
  auth(UserRole.USER),
  StatusController.getFeedByCountry,
);

// Get ALL statuses for a station (dashboard — includes expired)
router.get(
  "/station/:stationId/all",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION),
  StatusController.getAllStationStatuses,
);

// Get active statuses for a station feed (dashboard)
router.get(
  "/station/:stationId",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.USER),
  validateRequest(StatusDto.getStationStatuses),
  StatusController.getStationStatuses,
);

// Record a view for a status (app users)
router.post(
  "/:id/view",
  auth(UserRole.USER),
  StatusController.recordView,
);

// Get single status by ID (any auth)
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.PARTNER_ADMIN, UserRole.STATION_ADMIN, UserRole.MEDIA_STATION, UserRole.USER),
  validateRequest(StatusDto.getStatusById),
  StatusController.getStatusById,
);

// Delete a status (station admin, super admin)
router.delete(
  "/:id",
  auth(UserRole.STATION_ADMIN, UserRole.SUPER_ADMIN),
  validateRequest(StatusDto.deleteStatus),
  StatusController.deleteStatus,
);

export const StatusRoutes = router;
