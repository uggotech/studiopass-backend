import mongoose from "mongoose";
import { logger } from "../../logger/logger";
import { StatusRepository } from "./status.repository";
import { StationRepository } from "../station/station.repository";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import { StatusView } from "../status-view/status-view.model";
import { StatusLike } from "./status-like.model";
import config from "../../config";
import { deleteFile } from "../../util/minio";
import { UserRole } from "../../shared/roles";
import AppError from "../../errors/AppError";
import { StatusCodes } from "http-status-codes";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function getLocalDayAndTime(timezone: string): { day: string; time: string } {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const day = dateFormatter.format(now).toLowerCase();
  const timeParts = timeFormatter.formatToParts(now);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";

  return { day, time: `${hour}:${minute}` };
}

function getWeekStart(timezone: string): Date {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Get the Monday of this week in the station's timezone
  const parts = dateFormatter.formatToParts(now);
  const dayName = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "monday";
  const dayIndex = DAYS_OF_WEEK.indexOf(dayName);

  // Calculate days since Monday (Monday = 0)
  const daysSinceMonday = dayIndex === 0 ? 6 : dayIndex - 1; // Sunday = 6 days after Monday

  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);

  return monday;
}

function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function timeIsWithinWindow(targetTime: string, currentTime: string, windowMinutes: number = 15): boolean {
  const [tHour = 0, tMin = 0] = targetTime.split(":").map(Number);
  const [cHour = 0, cMin = 0] = currentTime.split(":").map(Number);

  const targetMinutes = tHour * 60 + tMin;
  const currentMinutes = cHour * 60 + cMin;

  return Math.abs(currentMinutes - targetMinutes) < windowMinutes;
}

// ─── Top Fans Calculation ────────────────────────────────────────────────────

interface TopFanResult {
  user: string;
  name: string;
  creditsUsed: number;
  rank: number;
}

async function calculateTopFans(
  stationId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<TopFanResult[]> {
  const results = await CreditTransaction.aggregate([
    {
      $match: {
        station: new mongoose.Types.ObjectId(stationId),
        type: { $in: ["message_deduction", "call_deduction"] },
        status: "completed",
        createdAt: { $gte: weekStart, $lte: weekEnd },
      },
    },
    {
      $group: {
        _id: "$user",
        totalCredits: { $sum: { $abs: "$amount" } },
      },
    },
    { $sort: { totalCredits: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "userDoc",
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        user: "$_id",
        name: { $ifNull: ["$userDoc.fullName", "Unknown"] },
        creditsUsed: "$totalCredits",
      },
    },
  ]);

  return results.map((r, i) => ({
    user: r.user.toString(),
    name: r.name,
    creditsUsed: r.creditsUsed,
    rank: i + 1,
  }));
}

// ─── Generate Posts for One Station ──────────────────────────────────────────

async function generateWeeklyTopFanPostsForStation(
  stationId: string,
  stationName: string,
  timezone: string,
  expiryHours: number = 168,
): Promise<number> {
  const weekStart = getWeekStart(timezone);

  // Check if already generated this week (unique index will also enforce this)
  const existing = await StatusRepository.findByStationAndWeek(stationId, weekStart);
  if (existing) {
    logger.info(`[StatusCron] Skipping ${stationName} — already generated for week ${weekStart.toISOString()}`);
    return 0;
  }

  const weekEnd = getWeekEnd(weekStart);
  const topFans = await calculateTopFans(stationId, weekStart, weekEnd);

  if (topFans.length === 0) {
    logger.info(`[StatusCron] No top fans for ${stationName} this week`);
    return 0;
  }

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  // Create individual status for each fan
  const statusDocs = topFans.map((fan) => ({
    station: stationId,
    type: "auto_weekly_top_fans" as const,
    content: `Congrats ${fan.name}! You're #${fan.rank} top fan at ${stationName} with ${fan.creditsUsed} credits used this week!`,
    topFan: {
      user: fan.user,
      name: fan.name,
      creditsUsed: fan.creditsUsed,
      rank: fan.rank,
    },
    weekStart,
    weekEnd,
    expiresAt,
    viewCount: 0,
  }));

  try {
    await StatusRepository.createMany(statusDocs);
    logger.info(`[StatusCron] Created ${statusDocs.length} top fan posts for ${stationName}`);
    return statusDocs.length;
  } catch (error: any) {
    // Duplicate key = race condition (another run already created these)
    if (error?.code === 11000) {
      logger.info(`[StatusCron] Skipping ${stationName} — duplicate week (race condition handled)`);
      return 0;
    }
    throw error;
  }
}

// ─── Manual Trigger ──────────────────────────────────────────────────────────

const generateManual = async (stationId: string) => {
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const country = station.country as any;
  const timezone = country?.timezone || "UTC";
  const expiryHours = station.statusConfig?.autoPostExpiryHours ?? 168;

  const count = await generateWeeklyTopFanPostsForStation(
    stationId,
    station.name,
    timezone,
    expiryHours,
  );

  if (count === 0) {
    return { message: "No top fans found or posts already exist for this week", count: 0 };
  }

  return { message: `Created ${count} top fan posts`, count };
};

// ─── Cron Job: Per-Station Weekly Check ──────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

async function checkAllStations() {
  try {
    const stations = await StationRepository.findAll({ isActive: true }, { limit: 500 });

    for (const station of stations) {
      const stationId = (station._id as any).toString();
      const country = station.country as any;
      const timezone = country?.timezone || "UTC";

      const config = station.statusConfig;
      const targetDay = config?.weeklyTopFansDay || "monday";
      const targetTime = config?.weeklyTopFansTime || "00:00";
      const expiryHours = config?.autoPostExpiryHours ?? 168;

      const { day, time } = getLocalDayAndTime(timezone);

      if (day === targetDay && timeIsWithinWindow(targetTime, time)) {
        logger.info(`[StatusCron] Triggering weekly top fans for ${station.name} (${timezone})`);
        await generateWeeklyTopFanPostsForStation(
          stationId,
          station.name,
          timezone,
          expiryHours,
        );
      }
    }
  } catch (error) {
    logger.error("[StatusCron] Error checking stations:", error);
  }
}

export function startWeeklyTopFansScheduler(intervalMs: number = 15 * 60 * 1000) {
  if (schedulerInterval) return;
  logger.info(`[StatusCron] Starting weekly top fans scheduler with ${intervalMs / 1000}s interval`);
  checkAllStations(); // Run once immediately on start
  schedulerInterval = setInterval(checkAllStations, intervalMs);
}

export function stopWeeklyTopFansScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("[StatusCron] Weekly top fans scheduler stopped");
  }
}

// ─── CRUD Service ────────────────────────────────────────────────────────────

const createStatus = async (data: {
  stationId: string;
  createdBy: string;
  content: string;
  media?: string;
  mediaType?: "image" | "video";
  thumbnail?: string;
  expiresAt?: string;
  callerRole?: string;
  userPartnerId?: string;
}) => {
  const station = await StationRepository.findById(data.stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  if (!station.isActive) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Cannot create status posts for an inactive or suspended station");
  }

  // Scoping check for partner admin
  if (data.callerRole === UserRole.PARTNER_ADMIN) {
    const stationPartnerId = (station as any).partner?._id?.toString() || (station as any).partner?.toString();
    if (stationPartnerId !== data.userPartnerId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You don't have permission to create statuses for this station");
    }
  }

  // Media MIME/extension validation for station status updates
  if (data.media) {
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm"];
    const rawExt = data.media.includes(".")
      ? data.media.substring(data.media.lastIndexOf("."))
      : "";
    const ext = (rawExt.split("?")[0] || "").toLowerCase();
    if (!ext || !allowedExtensions.includes(ext)) {
      throw new AppError(
        StatusCodes.BAD_REQUEST,
        `Invalid media type '${ext}'. Allowed media extensions: ${allowedExtensions.join(", ")}`,
      );
    }
  }

  const expiresAt = data.expiresAt
    ? new Date(data.expiresAt)
    : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24h

  return StatusRepository.create({
    station: data.stationId,
    createdBy: data.createdBy,
    type: "manual",
    content: data.content,
    media: data.media,
    mediaType: data.mediaType,
    thumbnail: data.thumbnail,
    expiresAt,
    viewCount: 0,
    likeCount: 0,
  });
};

const getStationStatuses = async (stationId: string, page: number, limit: number) => {
  const skip = (page - 1) * limit;
  const [statuses, total] = await Promise.all([
    StatusRepository.findActiveByStation(stationId, skip, limit),
    StatusRepository.countActiveByStation(stationId),
  ]);

  return {
    statuses,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getAllStationStatuses = async (
  stationId: string,
  page: number,
  limit: number,
  scope?: { role?: string; partnerId?: string },
) => {
  const skip = (page - 1) * limit;

  let targetStation: string | string[] = stationId;

  // Partner admin scoping when viewing all statuses
  if (scope?.role === UserRole.PARTNER_ADMIN && (stationId === "all" || !stationId)) {
    const partnerStations = await StationRepository.findAll(
      { partner: scope.partnerId },
      { limit: 1000 },
    );
    const stationIds = partnerStations.map((s: any) => s._id.toString());
    if (stationIds.length === 0) {
      return {
        statuses: [],
        meta: { page, limit, total: 0, totalPage: 0 },
      };
    }
    targetStation = stationIds;
  }

  const [statuses, total, metrics] = await Promise.all([
    StatusRepository.findAllByStation(targetStation, skip, limit),
    StatusRepository.countAllByStation(targetStation),
    StatusRepository.getStationStatusMetrics(targetStation),
  ]);

  return {
    statuses,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
      activeCount: metrics.activeCount,
      expiredCount: metrics.expiredCount,
      totalViews: metrics.totalViews,
      totalLikes: metrics.totalLikes,
    },
  };
};

const getStatusById = async (id: string) => {
  const status = await StatusRepository.findById(id);
  if (!status) {
    throw new AppError(StatusCodes.NOT_FOUND, "Status not found");
  }
  return status;
};

const deleteStatus = async (
  id: string,
  callerRole?: string,
  userPartnerId?: string,
) => {
  const status = await StatusRepository.findById(id);
  if (!status) {
    throw new AppError(StatusCodes.NOT_FOUND, "Status not found");
  }

  // Scoping check for partner admin
  if (callerRole === UserRole.PARTNER_ADMIN) {
    const station = await StationRepository.findById(status.station._id?.toString() || status.station.toString());
    const stationPartnerId = (station as any)?.partner?._id?.toString() || (station as any)?.partner?.toString();
    if (stationPartnerId !== userPartnerId) {
      throw new AppError(StatusCodes.FORBIDDEN, "You don't have permission to delete statuses for this station");
    }
  }

  const removeMinioMedia = async (filePath?: string) => {
    if (!filePath) return;
    try {
      const relativeName = filePath.replace(new RegExp(`^${config.minio.bucket}/`), "");
      await deleteFile(relativeName);
    } catch (err) {
      logger.warn(`[StatusService] Failed to delete file from MinIO: ${filePath}`, err);
    }
  };

  await Promise.all([
    StatusRepository.deleteById(id),
    StatusView.deleteMany({ status: id }),
    StatusLike.deleteMany({ status: id }),
    removeMinioMedia(status.media),
    removeMinioMedia(status.thumbnail),
  ]);

  return status;
};

// ─── App Feed (grouped by station for a country) ─────────────────────────────

const getFeedByCountry = async (countryId: string, userId?: string) => {
  const statuses = await StatusRepository.findActiveByCountry(countryId, userId);

  // Group by station
  const stationMap = new Map<string, { station: any; statuses: any[] }>();

  for (const status of statuses) {
    const stationId = status.station.toString();
    if (!stationMap.has(stationId)) {
      stationMap.set(stationId, {
        station: {
          _id: status.station,
          name: status.stationName || "",
          logo: status.stationLogo || "",
          isVerified: status.stationIsVerified || false,
        },
        statuses: [],
      });
    }
    stationMap.get(stationId)!.statuses.push(status);
  }

  // Inside each station, sort statuses chronologically (oldest active first -> newest active last)
  // so story playback starts from the oldest active post and progresses to the newest post
  for (const entry of stationMap.values()) {
    entry.statuses.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return Array.from(stationMap.values());
};

// ─── View Tracking ───────────────────────────────────────────────────────────

const recordView = async (statusId: string, userId: string) => {
  const status = await StatusRepository.findById(statusId);
  if (!status) {
    throw new AppError(StatusCodes.NOT_FOUND, "Status not found");
  }

  // Try to create view record (unique index prevents duplicates)
  try {
    await StatusView.create({ status: statusId, user: userId });
    // Increment view count only for new views
    await StatusRepository.incrementViewCount(statusId);
  } catch (error: any) {
    // Duplicate key = already viewed, skip silently
    if (error?.code !== 11000) {
      throw error;
    }
  }

  return { success: true };
};

// ─── Like / Reaction (One-way like, Instagram Story style) ───────────────────

const toggleLike = async (statusId: string, userId: string) => {
  const status = await StatusRepository.findById(statusId);
  if (!status) {
    throw new AppError(StatusCodes.NOT_FOUND, "Status not found");
  }

  const existing = await StatusLike.findOne({ status: statusId, user: userId });
  if (existing) {
    // Already liked: once liked, it cannot be un-liked (Instagram story behavior)
    const count = await StatusLike.countDocuments({ status: statusId });
    return {
      isLiked: true,
      likeCount: count,
    };
  }

  try {
    await StatusLike.create({ status: statusId, user: userId });
  } catch (error: any) {
    if (error?.code !== 11000) {
      throw error;
    }
  }

  // Exact distinct like count from StatusLike collection to prevent any counter drift
  const actualLikeCount = await StatusLike.countDocuments({ status: statusId });
  await StatusRepository.updateById(statusId, { likeCount: actualLikeCount });

  return {
    isLiked: true,
    likeCount: actualLikeCount,
  };
};

export const StatusService = {
  createStatus,
  getStationStatuses,
  getAllStationStatuses,
  getStatusById,
  deleteStatus,
  generateManual,
  getFeedByCountry,
  recordView,
  toggleLike,
  startWeeklyTopFansScheduler,
  stopWeeklyTopFansScheduler,
};
