import { Show } from "./show.model";
import { TShow } from "./show.interface";

const findByStation = (stationId: string): Promise<TShow[]> => {
  return Show.find({ station: stationId, isActive: true })
    .select("name days startTime endTime")
    .sort({ startTime: 1 })
    .lean();
};

const findById = (id: string): Promise<TShow | null> => {
  return Show.findById(id).lean();
};

const findByIdPopulated = (id: string) => {
  return Show.findById(id)
    .populate("station", "name stationCode category country")
    .populate("presenter", "fullName avatar")
    .lean();
};

const findAll = (
  filter: Record<string, unknown>,
  options: { skip?: number; limit?: number } = {},
): Promise<TShow[]> => {
  const query = Show.find(filter)
    .populate("station", "name stationCode category")
    .populate("presenter", "fullName avatar")
    .sort({ createdAt: -1 });

  if (options.skip) query.skip(options.skip);
  if (options.limit) query.limit(options.limit);

  return query.lean();
};

const count = (filter: Record<string, unknown>): Promise<number> => {
  return Show.countDocuments(filter);
};

const updatePresenter = (showId: string, presenterId: string | null): Promise<TShow | null> => {
  return Show.findByIdAndUpdate(showId, { presenter: presenterId }, { new: true }).lean();
};

const findActiveShowForStation = async (stationId: string, timezone: string): Promise<TShow | null> => {
  const now = new Date();

  // Safe timezone resolution with fallback to UTC
  let safeTimezone = timezone && timezone.trim() ? timezone.trim() : "UTC";
  let dateFormatter: Intl.DateTimeFormat;
  let timeFormatter: Intl.DateTimeFormat;

  try {
    dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimezone,
      weekday: "long",
    });
    timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: safeTimezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    safeTimezone = "UTC";
    dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
    });
    timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  const dayOfWeek = dateFormatter.format(now).toLowerCase();
  const timeParts = timeFormatter.formatToParts(now);
  const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const currentTime = `${hour}:${minute}`;

  // Fetch all active shows for this station on today's day
  const candidateShows = await Show.find({
    station: stationId,
    isActive: true,
    days: dayOfWeek as any,
  }).lean();

  // Find the active show, handling midnight-spanning shows (e.g. 19:00 - 00:00)
  for (const show of candidateShows) {
    if (show.startTime <= show.endTime) {
      // Normal show: 06:00 - 12:00
      // Active when startTime <= currentTime < endTime
      if (show.startTime <= currentTime && currentTime < show.endTime) {
        return show;
      }
    } else {
      // Midnight-spanning show: 19:00 - 00:00
      // Active when currentTime >= startTime OR currentTime < endTime
      if (currentTime >= show.startTime || currentTime < show.endTime) {
        return show;
      }
    }
  }

  return null;
};

const create = (data: Partial<TShow>): Promise<TShow> => {
  return Show.create(data);
};

export interface OverlapConflict {
  showId: string;
  showName: string;
  days: string[];
  startTime: string;
  endTime: string;
}

const checkOverlap = async (
  stationId: string,
  days: string[],
  startTime: string,
  endTime: string,
  excludeShowId?: string,
): Promise<OverlapConflict | null> => {
  // Fetch candidate shows that share at least one day
  const filter: Record<string, unknown> = {
    station: stationId,
    isActive: true,
    days: { $in: days as any },
  };
  if (excludeShowId) {
    filter._id = { $ne: excludeShowId };
  }
  const candidateShows = await Show.find(filter).lean();

  // Check time overlap handling midnight-spanning shows
  for (const existing of candidateShows) {
    const existingStart = existing.startTime;
    const existingEnd = existing.endTime;
    let hasTimeOverlap = false;

    // Both shows normal (start < end)
    if (startTime < endTime && existingStart < existingEnd) {
      // Standard overlap: new starts before existing ends AND new ends after existing starts
      if (startTime < existingEnd && endTime > existingStart) {
        hasTimeOverlap = true;
      }
    }
    // New show spans midnight (start >= end), existing is normal
    else if (startTime >= endTime && existingStart < existingEnd) {
      // New show wraps: active from startTime to 24:00 AND 00:00 to endTime
      // Overlaps with existing if existing overlaps either half
      if (startTime < existingEnd || endTime > existingStart) {
        hasTimeOverlap = true;
      }
    }
    // Existing show spans midnight, new is normal
    else if (startTime < endTime && existingStart >= existingEnd) {
      if (existingStart < endTime || existingEnd > startTime) {
        hasTimeOverlap = true;
      }
    }
    // Both span midnight — they always overlap if they share a day
    else {
      hasTimeOverlap = true;
    }

    if (hasTimeOverlap) {
      // Find the overlapping days between new show and existing show
      const overlappingDays = days.filter((d) => existing.days.includes(d as any));
      return {
        showId: existing._id.toString(),
        showName: existing.name,
        days: overlappingDays,
        startTime: existingStart,
        endTime: existingEnd,
      };
    }
  }

  return null;
};

const findByPresenter = (presenterId: string): Promise<TShow[]> => {
  return Show.find({ presenter: presenterId, isActive: true })
    .populate("station", "name stationCode category country")
    .populate("presenter", "fullName avatar")
    .sort({ startTime: 1 })
    .lean();
};

const checkPresenterOverlap = async (
  presenterId: string,
  days: string[],
  startTime: string,
  endTime: string,
  excludeShowId?: string,
): Promise<OverlapConflict | null> => {
  // Find all active shows assigned to this presenter that share at least one day
  const filter: Record<string, unknown> = {
    presenter: presenterId,
    isActive: true,
    days: { $in: days as any },
  };
  if (excludeShowId) {
    filter._id = { $ne: excludeShowId };
  }

  const presenterShows = await Show.find(filter).lean();

  for (const existing of presenterShows) {
    const existingStart = existing.startTime;
    const existingEnd = existing.endTime;
    let hasTimeOverlap = false;

    // Both normal
    if (startTime < endTime && existingStart < existingEnd) {
      if (startTime < existingEnd && endTime > existingStart) {
        hasTimeOverlap = true;
      }
    }
    // New spans midnight, existing normal
    else if (startTime >= endTime && existingStart < existingEnd) {
      if (startTime < existingEnd || endTime > existingStart) {
        hasTimeOverlap = true;
      }
    }
    // Existing spans midnight, new normal
    else if (startTime < endTime && existingStart >= existingEnd) {
      if (existingStart < endTime || existingEnd > startTime) {
        hasTimeOverlap = true;
      }
    }
    // Both span midnight
    else {
      hasTimeOverlap = true;
    }

    if (hasTimeOverlap) {
      const overlappingDays = days.filter((d) => existing.days.includes(d as any));
      return {
        showId: existing._id.toString(),
        showName: existing.name,
        days: overlappingDays,
        startTime: existingStart,
        endTime: existingEnd,
      };
    }
  }

  return null;
};

const deactivateByStation = (stationId: string): Promise<{ modifiedCount: number }> => {
  return Show.updateMany(
    { station: stationId, isActive: true },
    { $set: { isActive: false } },
  ).then((result) => ({ modifiedCount: result.modifiedCount }));
};

const reactivateByStation = (stationId: string): Promise<{ modifiedCount: number }> => {
  return Show.updateMany(
    { station: stationId, isActive: false },
    { $set: { isActive: true } },
  ).then((result) => ({ modifiedCount: result.modifiedCount }));
};

const updateById = (id: string, data: Partial<TShow>): Promise<TShow | null> => {
  return Show.findByIdAndUpdate(id, data, { new: true }).lean();
};

export const ShowRepository = {
  findByStation,
  findById,
  findByIdPopulated,
  findByPresenter,
  findAll,
  count,
  updatePresenter,
  findActiveShowForStation,
  create,
  updateById,
  checkOverlap,
  checkPresenterOverlap,
  deactivateByStation,
  reactivateByStation,
};
