import { Request, Response } from "express";
import catchAsync from "../../shared/catchAsync";
import sendResponse from "../../shared/sendResponse";
import { UserService } from "./user.service";
import { UserRepository } from "./user.repository";
import { StationRepository } from "../station/station.repository";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.getMyProfile(user._id.toString());

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Profile fetched successfully",
    data: result,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  // processAndUpload middleware puts the file path in req.body.image or req.body.avatar
  const avatar = req.body.image || req.body.avatar || undefined;
  const result = await UserService.updateMyProfile(user._id.toString(), {
    ...req.body,
    ...(avatar && { avatar }),
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Profile updated successfully",
    data: result,
  });
});

const updateMyPreferences = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.updateMyPreferences(user._id.toString(), req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Preferences updated successfully",
    data: result,
  });
});

const getAllStationAdmins = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = user?.partnerId ? { partnerId: user.partnerId.toString() } : undefined;
  const result = await UserService.getAllStationAdmins(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Station admins fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const getAllMediaStationUsers = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope: { partnerId?: string; stationId?: string } = {};
  if (user?.stationId) scope.stationId = user.stationId.toString();
  else if (user?.partnerId) scope.partnerId = user.partnerId.toString();

  const result = await UserService.getAllMediaStationUsers(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Media station users fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const createMediaStation = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userStationId = user?.stationId?.toString();
  const userPartnerId = user?.partnerId?.toString();

  if (user.role === "station_admin" && userStationId && !req.body.stationId) {
    req.body.stationId = userStationId;
  }

  const { stationId } = req.body;

  // Scope check: ensure the station belongs to the user's scope
  if (stationId) {
    if ((user.role === "partner_admin" || user.role === "customer_care") && userPartnerId) {
      const station = await StationRepository.findById(stationId);
      const stationPartnerId = (station?.partner as any)?._id?.toString() || station?.partner?.toString();
      if (!station || stationPartnerId !== userPartnerId) {
        throw new AppError(StatusCodes.FORBIDDEN, "You can only create users for stations in your partner organization");
      }
    } else if (user.role === "station_admin" && userStationId) {
      if (stationId !== userStationId) {
        throw new AppError(StatusCodes.FORBIDDEN, "You can only create users for your own station");
      }
    }
  }

  const result = await UserService.createMediaStation(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Media station user created successfully",
    data: result,
  });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const targetUserId = String(req.params.id);

  // Scope check: partner_admin can only view users in their partner
  if (user.role === "partner_admin" && user.partnerId) {
    const targetUser = await UserService.getUserById(targetUserId);
    if (targetUser.partnerId?.toString() !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only view users in your partner organization");
    }
  }

  const result = await UserService.getUserById(targetUserId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User fetched successfully",
    data: result,
  });
});

const updateUserById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const targetUserId = String(req.params.id);

  if (user.role === "partner_admin" && user.partnerId) {
    const targetUser = await UserRepository.findById(targetUserId);
    if (!targetUser) {
      throw new AppError(StatusCodes.NOT_FOUND, "User not found");
    }
    let targetPartnerId = targetUser.partnerId?.toString();
    if (!targetPartnerId && targetUser.stationId) {
      const station = await StationRepository.findById(targetUser.stationId.toString());
      targetPartnerId = (station?.partner as any)?._id?.toString() || station?.partner?.toString();
    }
    if (targetPartnerId !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only update users in your partner organization");
    }
  } else if (user.role === "station_admin" && user.stationId) {
    const targetUser = await UserRepository.findById(targetUserId);
    if (targetUser?.stationId?.toString() !== user.stationId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only update users in your station");
    }
  }

  const result = await UserService.updateUserById(targetUserId, req.body);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User updated successfully",
    data: result,
  });
});


const deactivateUser = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const targetUserId = String(req.params.id);

  // Scope check: partner_admin can only deactivate users in their partner
  if (user.role === "partner_admin" && user.partnerId) {
    const targetUser = await UserService.getUserById(targetUserId);
    if (targetUser.partnerId?.toString() !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only deactivate users in your partner organization");
    }
  }

  const result = await UserService.deactivateUser(targetUserId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User deactivated successfully",
    data: result,
  });
});

const reactivateUser = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const targetUserId = String(req.params.id);

  // Scope check: partner_admin can only reactivate users in their partner
  if (user.role === "partner_admin" && user.partnerId) {
    const targetUser = await UserService.getUserById(targetUserId);
    if (targetUser.partnerId?.toString() !== user.partnerId.toString()) {
      throw new AppError(StatusCodes.FORBIDDEN, "You can only reactivate users in your partner organization");
    }
  }

  const result = await UserService.reactivateUser(targetUserId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "User reactivated successfully",
    data: result,
  });
});

const updateFcmToken = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.updateFcmToken(user._id.toString(), req.body.fcmToken);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "FCM token updated successfully",
    data: result,
  });
});

const createPresenter = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userStationId = user?.stationId?.toString();
  const userPartnerId = user?.partnerId?.toString();

  if (user.role === "station_admin" && userStationId && !req.body.stationId) {
    req.body.stationId = userStationId;
  }

  const { stationId } = req.body;

  // Scope check: ensure the station belongs to the user's scope
  if (stationId) {
    if ((user.role === "partner_admin" || user.role === "customer_care") && userPartnerId) {
      const station = await StationRepository.findById(stationId);
      const stationPartnerId = (station?.partner as any)?._id?.toString() || station?.partner?.toString();
      if (!station || stationPartnerId !== userPartnerId) {
        throw new AppError(StatusCodes.FORBIDDEN, "You can only create presenters for stations in your partner organization");
      }
    } else if (user.role === "station_admin" && userStationId) {
      if (stationId !== userStationId) {
        throw new AppError(StatusCodes.FORBIDDEN, "You can only create presenters for your own station");
      }
    }
  }

  const result = await UserService.createPresenter(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Presenter created successfully",
    data: result,
  });
});

const getAllPresenters = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope: { partnerId?: string; stationId?: string } = {};
  if (user?.stationId) scope.stationId = user.stationId.toString();
  else if (user?.partnerId) scope.partnerId = user.partnerId.toString();

  const result = await UserService.getAllPresenters(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Presenters fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const getAllListeners = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope: { partnerId?: string; stationId?: string } = {};
  if (user?.stationId) scope.stationId = user.stationId.toString();
  else if (user?.partnerId) scope.partnerId = user.partnerId.toString();

  const result = await UserService.getAllListeners(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Listeners fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const getListenerById = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await UserService.getListenerById(String(req.params.id), user?.role);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Listener fetched successfully",
    data: result,
  });
});

const getListenerVotes = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getListenerVotes(String(req.params.id));

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Listener poll votes fetched successfully",
    data: result,
  });
});

const getAllCustomerCareUsers = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = {
    partnerId: user?.partnerId?.toString(),
    countryId: user?.country?.toString(),
  };

  const result = await UserService.getAllCustomerCareUsers(req.query, scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Customer care users fetched successfully",
    data: result.users,
    meta: result.meta,
  });
});

const getTopFans = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const scope = {
    stationId: user?.stationId?.toString(),
  };

  const result = await UserService.getTopFans(scope);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Top fans fetched successfully",
    data: result,
  });
});

const createCustomerCareUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.createCustomerCareUser(req.body);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Customer Care agent created successfully",
    data: result,
  });
});

const resetUser2FA = catchAsync(async (req: Request, res: Response) => {
  const targetUserId = String(req.params.id);
  const result = await UserService.resetUser2FA(targetUserId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Two-Factor authentication reset successfully",
    data: result,
  });
});

export const UserController = {
  getMyProfile,
  updateMyProfile,
  updateMyPreferences,
  getAllStationAdmins,
  getAllMediaStationUsers,
  createMediaStation,
  createPresenter,
  getAllPresenters,
  createCustomerCareUser,
  getAllCustomerCareUsers,
  getAllListeners,
  getListenerById,
  getListenerVotes,
  getTopFans,
  getUserById,
  updateUserById,
  deactivateUser,
  reactivateUser,
  updateFcmToken,
  resetUser2FA,
};
