import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ShowRepository } from "./show.repository";
import { StationRepository } from "../station/station.repository";
import { Country } from "../country/country.model";
import { User } from "../user/user.model";
import { TShow } from "./show.interface";

function computeShowStatus(show: TShow, timezone: string): "Active" | "Scheduled" | "Inactive" {
  if (!show.isActive) return "Inactive";

  const now = new Date();
  const localDateStr = now.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const localTimeStr = now.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const dayOfWeek = localDateStr.split(",")[0]?.trim().toLowerCase() || "";
  const currentTime = localTimeStr.slice(0, 5);

  // Handle shows that span midnight (endTime <= startTime, e.g. "19:00" to "00:00")
  const isWrapsMidnight = show.startTime >= show.endTime;
  const isOnAir =
    show.days.includes(dayOfWeek as any) &&
    (isWrapsMidnight
      ? currentTime >= show.startTime || currentTime < show.endTime
      : show.startTime <= currentTime && show.endTime > currentTime);

  return isOnAir ? "Active" : "Scheduled";
}

const getAllShows = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string },
) => {
  const filter: Record<string, unknown> = {};

  // Scope: station scoped
  if (scope?.stationId) {
    filter.station = scope.stationId;
  }
  // Scope: partner scoped — find all stations for this partner
  else if (scope?.partnerId) {
    const partnerStations = await StationRepository.findAll(
      { partner: scope.partnerId },
      { limit: 1000 },
    );
    const stationIds = partnerStations.map((s) => s._id);
    if (stationIds.length === 0) {
      return { shows: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
    }
    filter.station = { $in: stationIds };
  }
  // super_admin: no filter — sees all

  // Search
  if (query.search) {
    filter.name = { $regex: query.search, $options: "i" };
  }

  // Filter by station name (for super_admin/partner_admin)
  if (query.stationName) {
    const stations = await StationRepository.findAll(
      { name: query.stationName },
      { limit: 1000 },
    );
    const stationIds = stations.map((s) => s._id);
    if (stationIds.length === 0) {
      return { shows: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
    }
    filter.station = { $in: stationIds };
  }

  // Filter by presenter name
  if (query.presenterName) {
    const presenters = await User.find({
      fullName: { $regex: query.presenterName as string, $options: "i" },
      role: "presenter",
    }).select("_id").lean();
    const presenterIds = presenters.map((p) => p._id);
    if (presenterIds.length === 0) {
      return { shows: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
    }
    filter.presenter = { $in: presenterIds };
  }

  // Filter by status
  // Note: status is computed, so we can't filter directly in DB.
  // We'll do post-query filtering for status.

  // Pagination
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const [shows, total] = await Promise.all([
    ShowRepository.findAll(filter, { skip, limit }),
    ShowRepository.count(filter),
  ]);

  // Compute status for each show (needs station timezone)
  // Batch: group shows by station, look up timezone per station
  const stationTimezones = new Map<string, string>();
  const stationIds = [...new Set(shows.map((s) => {
    const station = s.station as any;
    return station?._id?.toString() || station?.toString() || "";
  }).filter(Boolean))];

  // Load station timezones
  await Promise.all(
    stationIds.map(async (sid) => {
      const station = await StationRepository.findById(sid);
      if (station?.country) {
        const country = await Country.findById(station.country).lean();
        stationTimezones.set(sid, country?.timezone || "UTC");
      } else {
        stationTimezones.set(sid, "UTC");
      }
    }),
  );

  const showsWithStatus = shows.map((s) => {
    const stationObj = s.station as any;
    const sid = stationObj?._id?.toString() || stationObj?.toString() || "";
    const timezone = stationTimezones.get(sid) || "UTC";
    const status = computeShowStatus(s, timezone);
    return { ...s, status };
  });

  // Post-filter by computed status
  let filtered = showsWithStatus;
  if (query.status) {
    filtered = showsWithStatus.filter((s) => s.status === query.status);
  }

  return {
    shows: filtered,
    meta: {
      page,
      limit,
      total: query.status ? filtered.length : total,
      totalPage: Math.ceil((query.status ? filtered.length : total) / limit),
    },
  };
};

const getShowById = async (id: string) => {
  const show = await ShowRepository.findByIdPopulated(id);
  if (!show) {
    throw new AppError(StatusCodes.NOT_FOUND, "Show not found");
  }

  // Compute status
  let status: "Active" | "Scheduled" | "Inactive" = "Scheduled";
  const station = show.station as any;
  if (station?.country) {
    const countryDoc = await Country.findById(station.country).lean();
    const timezone = countryDoc?.timezone || "UTC";
    status = computeShowStatus(show as TShow, timezone);
  }

  return {
    id: show._id,
    name: show.name,
    description: show.description,
    station: {
      id: station?._id,
      name: station?.name,
      stationCode: station?.stationCode,
      category: station?.category,
    },
    presenter: show.presenter
      ? {
          id: (show.presenter as any)._id,
          fullName: (show.presenter as any).fullName,
          avatar: (show.presenter as any).avatar,
        }
      : null,
    days: show.days,
    startTime: show.startTime,
    endTime: show.endTime,
    status,
    isActive: show.isActive,
    createdAt: show.createdAt,
  };
};

const getShowsByStation = async (stationId: string) => {
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const result = await getAllShows({}, { stationId });
  return result.shows;
};

const getActiveShow = async (stationId: string, timezone: string = "UTC") => {
  const show = await ShowRepository.findActiveShowForStation(stationId, timezone);
  if (!show) {
    return null;
  }
  return {
    id: show._id,
    name: show.name,
    days: show.days,
    startTime: show.startTime,
    endTime: show.endTime,
  };
};

function parseTimeToMinutes(time: string): number {
  const parts = time.split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

function computeTimeRemaining(endTime: string, timezone: string): number {
  const now = new Date();
  const localTimeStr = now.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const currentMinutes = parseTimeToMinutes(localTimeStr.slice(0, 5));
  const endMinutes = parseTimeToMinutes(endTime);

  // Handle midnight wrap: if end is "00:00" it means 24:00
  const adjustedEnd = endMinutes === 0 ? 24 * 60 : endMinutes;
  const remaining = adjustedEnd - currentMinutes;
  return Math.max(0, remaining);
}

function computeNextStartTime(startTime: string, days: string[], timezone: string): { minutesUntil: number; nextDay: string } | null {
  const now = new Date();
  const localDateStr = now.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const localTimeStr = now.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const currentDay = localDateStr.split(",")[0]?.trim().toLowerCase() || "";
  const currentMinutes = parseTimeToMinutes(localTimeStr.slice(0, 5));
  const startMinutes = parseTimeToMinutes(startTime);

  const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const currentDayIdx = dayOrder.indexOf(currentDay);

  // Check if show is today and hasn't started yet
  if (days.includes(currentDay as any) && currentMinutes < startMinutes) {
    return { minutesUntil: startMinutes - currentMinutes, nextDay: currentDay };
  }

  // Find next upcoming day
  for (let i = 1; i <= 7; i++) {
    const nextDayIdx = (currentDayIdx + i) % 7;
    const nextDay = dayOrder[nextDayIdx] || "";
    if (days.includes(nextDay as any)) {
      let minutesUntil: number;
      if (i === 1) {
        // Tomorrow: minutes until midnight + start time
        minutesUntil = (24 * 60 - currentMinutes) + startMinutes;
      } else {
        // Days away: full days + start time
        minutesUntil = (i * 24 * 60 - currentMinutes) + startMinutes;
      }
      return { minutesUntil, nextDay };
    }
  }

  return null;
}

const getMyShows = async (userId: string) => {
  const shows = await ShowRepository.findByPresenter(userId);

  if (shows.length === 0) {
    return { assigned: false, currentShow: null, nextShow: null, allShows: [] };
  }

  // Resolve timezones for all shows
  const stationTimezones = new Map<string, string>();
  const stationIds = [...new Set(shows.map((s) => {
    const station = s.station as any;
    return station?._id?.toString() || station?.toString() || "";
  }).filter(Boolean))];

  await Promise.all(
    stationIds.map(async (sid) => {
      const station = await StationRepository.findById(sid);
      if (station?.country) {
        const country = await Country.findById(station.country).lean();
        stationTimezones.set(sid, country?.timezone || "UTC");
      } else {
        stationTimezones.set(sid, "UTC");
      }
    }),
  );

  // Compute status + time info for each show
  const enrichedShows = shows.map((s) => {
    const stationObj = s.station as any;
    const sid = stationObj?._id?.toString() || stationObj?.toString() || "";
    const timezone = stationTimezones.get(sid) || "UTC";
    const status = computeShowStatus(s, timezone);
    const station = s.station as any;
    const presenter = s.presenter as any;

    const base = {
      id: s._id,
      name: s.name,
      description: s.description,
      station: { id: station?._id, name: station?.name, stationCode: station?.stationCode },
      presenter: presenter ? { id: presenter._id, fullName: presenter.fullName } : null,
      days: s.days,
      startTime: s.startTime,
      endTime: s.endTime,
      status,
      timezone,
    };

    if (status === "Active") {
      const remaining = computeTimeRemaining(s.endTime, timezone);
      return { ...base, timeRemainingMinutes: remaining };
    }

    if (status === "Scheduled") {
      const next = computeNextStartTime(s.startTime, s.days, timezone);
      return { ...base, nextStartTime: next };
    }

    return base;
  });

  // Current show = Active
  const currentShow = enrichedShows.find((s) => s.status === "Active") || null;

  // Next show = Scheduled with smallest nextStartTime
  const scheduledShows = enrichedShows
    .filter((s) => s.status === "Scheduled" && "nextStartTime" in s && s.nextStartTime)
    .sort((a: any, b: any) => (a.nextStartTime?.minutesUntil ?? Infinity) - (b.nextStartTime?.minutesUntil ?? Infinity));

  const nextShow = scheduledShows[0] || null;

  return {
    assigned: true,
    currentShow,
    nextShow,
    allShows: enrichedShows,
  };
};

const createShow = async (data: {
  name: string;
  stationId: string;
  presenterId?: string;
  startTime: string;
  endTime: string;
  days: string[];
  description?: string;
}) => {
  // Validate station exists
  const station = await StationRepository.findById(data.stationId);
  if (!station) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Station not found");
  }

  // Validate presenter if provided
  if (data.presenterId) {
    const { User } = await import("../user/user.model");
    const presenter = await User.findById(data.presenterId);
    if (!presenter || presenter.role !== "presenter") {
      throw new AppError(StatusCodes.BAD_REQUEST, "Presenter not found");
    }
  }

  // Check for overlap: same station, same days, overlapping times
  const hasOverlap = await ShowRepository.checkOverlap(
    data.stationId,
    data.days,
    data.startTime,
    data.endTime,
  );
  if (hasOverlap) {
    throw new AppError(StatusCodes.CONFLICT, "Show overlaps with an existing show on the same station");
  }

  // Map day abbreviations to full names
  const dayMap: Record<string, string> = {
    MON: "monday", TUE: "tuesday", WED: "wednesday",
    THU: "thursday", FRI: "friday", SAT: "saturday", SUN: "sunday",
  };
  const fullDays = data.days.map((d) => dayMap[d] || d.toLowerCase()) as any[];

  const show = await ShowRepository.create({
    station: station._id,
    name: data.name,
    description: data.description,
    days: fullDays,
    startTime: data.startTime,
    endTime: data.endTime,
    presenter: data.presenterId ? (data.presenterId as any) : undefined,
    isActive: true,
  });

  return {
    id: show._id,
    name: show.name,
    station: { id: station._id, name: station.name, stationCode: station.stationCode },
    days: show.days,
    startTime: show.startTime,
    endTime: show.endTime,
  };
};

export const ShowService = {
  getAllShows,
  getShowById,
  getShowsByStation,
  getActiveShow,
  getMyShows,
  createShow,
};
