import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ShowRepository } from "./show.repository";
import { StationRepository } from "../station/station.repository";
import { Country } from "../country/country.model";
import { User } from "../user/user.model";
import { UserRepository } from "../user/user.repository";
import { TShow } from "./show.interface";
import { UserRole } from "../../shared/roles";

function computeShowStatus(show: TShow, timezone: string): "Active" | "Scheduled" | "Inactive" {
  if (!show.isActive) return "Inactive";

  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const dayOfWeek = dateFormatter.format(now).toLowerCase();

  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeParts = timeFormatter.formatToParts(now);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const currentTime = `${hour}:${minute}`;

  const dayOrder = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const currentDayIdx = dayOrder.indexOf(dayOfWeek);
  const yesterdayIdx = (currentDayIdx - 1 + 7) % 7;
  const yesterday = dayOrder[yesterdayIdx];

  const isWrapsMidnight = show.startTime >= show.endTime;
  let isOnAir = false;

  if (isWrapsMidnight) {
    // Active if:
    // 1) Started today and currently before midnight (currentTime >= startTime)
    // 2) OR started yesterday and currently past midnight into today (currentTime < endTime)
    isOnAir =
      (show.days.includes(dayOfWeek as any) && currentTime >= show.startTime) ||
      (show.days.includes(yesterday as any) && currentTime < show.endTime);
  } else {
    // Normal daytime show
    isOnAir =
      show.days.includes(dayOfWeek as any) &&
      show.startTime <= currentTime &&
      currentTime < show.endTime;
  }

  return isOnAir ? "Active" : "Scheduled";
}

const getAllShows = async (
  query: Record<string, unknown>,
  scope?: { partnerId?: string; stationId?: string },
) => {
  const filter: Record<string, unknown> = {};

  // Query parameter overrides / specifies station
  const targetStation = (query.station as string) || (query.stationId as string);
  if (targetStation) {
    filter.station = targetStation;
  }
  // Scope: station scoped
  else if (scope?.stationId) {
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

  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Search
  if (query.search) {
    filter.name = { $regex: escapeRegex(query.search as string), $options: "i" };
  }

  // Filter by station name (for super_admin/partner_admin)
  if (query.stationName) {
    const stationFilter: Record<string, unknown> = { name: query.stationName };
    if (scope?.partnerId) stationFilter.partner = scope.partnerId;
    const stations = await StationRepository.findAll(
      stationFilter,
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
      fullName: { $regex: escapeRegex(query.presenterName as string), $options: "i" },
      role: "presenter" as any,
    }).select("_id").lean();
    const presenterIds = presenters.map((p) => p._id);
    if (presenterIds.length === 0) {
      return { shows: [], meta: { page: 1, limit: 20, total: 0, totalPage: 0 } };
    }
    filter.presenter = { $in: presenterIds };
  }

  // Pagination
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  if (query.status === "Active") {
    filter.isActive = true;
  } else if (query.status === "Inactive") {
    filter.isActive = false;
  } else if (query.status === "Scheduled") {
    filter.isActive = true;
  }

  const [shows, total] = await Promise.all([
    ShowRepository.findAll(filter, { skip, limit }),
    ShowRepository.count(filter),
  ]);

  // Compute status for each show (needs station timezone)
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
        const countryId = (station.country as any)?._id || station.country;
        const country = await Country.findById(countryId).lean();
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
    return {
      ...s,
      id: s._id.toString(),
      status,
    };
  });

  return {
    shows: showsWithStatus,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

const getShowById = async (id: string) => {
  const show = await ShowRepository.findByIdPopulated(id);
  if (!show) {
    throw new AppError(StatusCodes.NOT_FOUND, "Show not found");
  }

  // Compute status reliably
  let timezone = "UTC";
  const stationObj = show.station as any;
  const stationId = stationObj?._id?.toString() || stationObj?.toString() || "";
  if (stationId) {
    const station = await StationRepository.findById(stationId);
    if (station?.country) {
      const countryId = (station.country as any)?._id || station.country;
      const countryDoc = await Country.findById(countryId).lean();
      if (countryDoc?.timezone) timezone = countryDoc.timezone;
    }
  }

  const status = computeShowStatus(show as TShow, timezone);

  return {
    id: show._id,
    name: show.name,
    description: show.description,
    station: {
      id: stationObj?._id || stationObj?.id || stationId,
      name: stationObj?.name || "",
      stationCode: stationObj?.stationCode || "",
      category: stationObj?.category || "",
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
  const station = await StationRepository.findById(stationId);
  if (station && station.category === "channel") {
    return {
      id: "channel_247",
      name: station.name,
      isChannel: true,
      timeRemainingMinutes: 0,
    };
  }

  const show = await ShowRepository.findActiveShowForStation(stationId, timezone);
  if (!show) {
    return null;
  }
  const timeRemainingMinutes = computeTimeRemaining(show.endTime, timezone, show.startTime);
  return {
    id: show._id,
    name: show.name,
    days: show.days,
    startTime: show.startTime,
    endTime: show.endTime,
    timeRemainingMinutes,
    isChannel: false,
  };
};

function parseTimeToMinutes(time: string): number {
  const parts = time.split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

function computeTimeRemaining(endTime: string, timezone: string, startTime?: string): number {
  const now = new Date();
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeParts = timeFormatter.formatToParts(now);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const currentMinutes = parseTimeToMinutes(`${hour}:${minute}`);
  const endMinutes = parseTimeToMinutes(endTime);

  // Handle midnight-spanning shows (e.g. 22:00 - 02:00)
  if (startTime) {
    const startMinutes = parseTimeToMinutes(startTime);
    if (startMinutes >= endMinutes) {
      if (currentMinutes >= startMinutes) {
        // Before midnight: remaining = minutes to midnight + endMinutes
        return Math.max(0, (24 * 60 - currentMinutes) + endMinutes);
      } else {
        // After midnight: remaining = endMinutes - currentMinutes
        return Math.max(0, endMinutes - currentMinutes);
      }
    }
  }

  // Normal show: remaining = endTime - currentTime
  // Handle midnight wrap: if end is "00:00" it means 24:00
  const adjustedEnd = endMinutes === 0 ? 24 * 60 : endMinutes;
  const remaining = adjustedEnd - currentMinutes;
  return Math.max(0, remaining);
}

function computeNextStartTime(startTime: string, days: string[], timezone: string): { minutesUntil: number; nextDay: string } | null {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const localDateStr = dateFormatter.format(now);
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeParts = timeFormatter.formatToParts(now);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const currentTimeStr = `${hour}:${minute}`;

  const currentDay = localDateStr.split(",")[0]?.trim().toLowerCase() || "";
  const currentMinutes = parseTimeToMinutes(currentTimeStr);
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
        const countryId = (station.country as any)?._id || station.country;
        const country = await Country.findById(countryId).lean();
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
      const remaining = computeTimeRemaining(s.endTime, timezone, s.startTime);
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

const dayMap: Record<string, string> = {
  MON: "monday", TUE: "tuesday", WED: "wednesday",
  THU: "thursday", FRI: "friday", SAT: "saturday", SUN: "sunday",
};

const normalizeDays = (days: string[]): string[] => {
  return days.map((d) => dayMap[d] || d.toLowerCase());
};

const formatDays = (days: string[]): string => {
  return days.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ");
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

  // Normalize day abbreviations to full names BEFORE any overlap checks
  const fullDays = normalizeDays(data.days) as any[];

  // Validate presenter if provided
  if (data.presenterId) {
    const presenter = await UserRepository.findById(data.presenterId);
    if (!presenter || presenter.role !== UserRole.PRESENTER) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Presenter not found");
    }
    if (presenter.stationId && presenter.stationId.toString() !== data.stationId) {
      throw new AppError(StatusCodes.BAD_REQUEST, "Presenter belongs to a different station");
    }

    // Check presenter doesn't already have an overlapping show
    const presenterConflict = await ShowRepository.checkPresenterOverlap(
      data.presenterId,
      fullDays,
      data.startTime,
      data.endTime,
    );
    if (presenterConflict) {
      throw new AppError(
        StatusCodes.CONFLICT,
        `Presenter already has a conflicting show "${presenterConflict.showName}" on ${formatDays(presenterConflict.days)} (${presenterConflict.startTime} - ${presenterConflict.endTime})`,
      );
    }
  }

  // Check for overlap: same station, same days, overlapping times
  const stationConflict = await ShowRepository.checkOverlap(
    data.stationId,
    fullDays,
    data.startTime,
    data.endTime,
  );
  if (stationConflict) {
    throw new AppError(
      StatusCodes.CONFLICT,
      `Show overlaps with existing show "${stationConflict.showName}" on ${formatDays(stationConflict.days)} (${stationConflict.startTime} - ${stationConflict.endTime})`,
    );
  }

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

const updateShow = async (
  showId: string,
  data: {
    name?: string;
    description?: string;
    stationId?: string;
    presenterId?: string | null;
    days?: string[];
    startTime?: string;
    endTime?: string;
    status?: "Active" | "Scheduled" | "Inactive";
  },
  scope?: { partnerId?: string; stationId?: string },
) => {
  const show = await ShowRepository.findById(showId);
  if (!show) {
    throw new AppError(StatusCodes.NOT_FOUND, "Show not found");
  }

  // Cross-station security check for station_admin
  const stationId = (show.station as any)?._id?.toString() || show.station?.toString();
  if (scope?.stationId && stationId !== scope.stationId) {
    throw new AppError(StatusCodes.FORBIDDEN, "You are not authorized to update this show");
  }

  // Determine target schedule fields (fallback to existing show values)
  const effectiveDays = data.days ? normalizeDays(data.days) : show.days;
  const effectiveStartTime = data.startTime ?? show.startTime;
  const effectiveEndTime = data.endTime ?? show.endTime;
  const effectiveStatus = data.status ?? (show as any).status ?? (show.isActive ? "Active" : "Inactive");
  const effectiveIsActive = effectiveStatus !== "Inactive";

  // 1. Time Order Validation
  if (effectiveStartTime === effectiveEndTime) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Start time and end time cannot be the same");
  }

  // 2. Determine target presenter ID
  let effectivePresenterId: string | null = null;
  if (data.presenterId !== undefined) {
    if (data.presenterId === null || data.presenterId === "" || data.presenterId === "unassign") {
      effectivePresenterId = null;
    } else {
      const presenter = await UserRepository.findById(data.presenterId);
      if (!presenter || presenter.role !== UserRole.PRESENTER) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Invalid presenter ID");
      }
      if (presenter.stationId && presenter.stationId.toString() !== stationId) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Presenter belongs to a different station");
      }
      effectivePresenterId = presenter._id.toString();
    }
  } else {
    effectivePresenterId = (show.presenter as any)?._id?.toString() || show.presenter?.toString() || null;
  }

  // 3. Check for Station Show Overlap Conflict (excluding current showId)
  if (effectiveIsActive) {
    const stationConflict = await ShowRepository.checkOverlap(
      stationId,
      effectiveDays,
      effectiveStartTime,
      effectiveEndTime,
      showId,
    );
    if (stationConflict) {
      throw new AppError(
        StatusCodes.CONFLICT,
        `Show overlaps with existing show "${stationConflict.showName}" on ${formatDays(stationConflict.days)} (${stationConflict.startTime} - ${stationConflict.endTime})`,
      );
    }
  }

  // 4. Check for Presenter Schedule Overlap Conflict (excluding current showId)
  if (effectivePresenterId && effectiveIsActive) {
    const presenterConflict = await ShowRepository.checkPresenterOverlap(
      effectivePresenterId,
      effectiveDays,
      effectiveStartTime,
      effectiveEndTime,
      showId,
    );
    if (presenterConflict) {
      throw new AppError(
        StatusCodes.CONFLICT,
        `Presenter already has a conflicting show "${presenterConflict.showName}" on ${formatDays(presenterConflict.days)} (${presenterConflict.startTime} - ${presenterConflict.endTime})`,
      );
    }
  }

  // 5. Construct update object
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.days !== undefined) updateData.days = effectiveDays;
  if (data.startTime !== undefined) updateData.startTime = effectiveStartTime;
  if (data.endTime !== undefined) updateData.endTime = effectiveEndTime;
  if (data.status !== undefined) {
    updateData.status = effectiveStatus;
    updateData.isActive = effectiveIsActive;
  }
  if (data.presenterId !== undefined) {
    updateData.presenter = effectivePresenterId;
  }

  const updated = await ShowRepository.updateById(showId, updateData as any);
  return getShowById(updated!._id.toString());
};

export const ShowService = {
  getAllShows,
  getShowById,
  getShowsByStation,
  getActiveShow,
  getMyShows,
  createShow,
  updateShow,
};
