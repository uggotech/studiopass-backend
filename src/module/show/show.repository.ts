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
    .populate("station", "name stationCode category")
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

  // Use Intl.DateTimeFormat.formatToParts for reliable cross-platform time extraction
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

const checkOverlap = async (
  stationId: string,
  days: string[],
  startTime: string,
  endTime: string,
): Promise<boolean> => {
  // Fetch candidate shows that share at least one day
  const candidateShows = await Show.find({
    station: stationId,
    isActive: true,
    days: { $in: days as any },
  }).lean();

  // Check time overlap handling midnight-spanning shows
  for (const existing of candidateShows) {
    const existingStart = existing.startTime;
    const existingEnd = existing.endTime;

    // Both shows normal (start < end)
    if (startTime < endTime && existingStart < existingEnd) {
      // Standard overlap: new starts before existing ends AND new ends after existing starts
      if (startTime < existingEnd && endTime > existingStart) {
        return true;
      }
    }
    // New show spans midnight (start >= end), existing is normal
    else if (startTime >= endTime && existingStart < existingEnd) {
      // New show wraps: active from startTime to 24:00 AND 00:00 to endTime
      // Overlaps with existing if existing overlaps either half
      if (startTime < existingEnd || endTime > existingStart) {
        return true;
      }
    }
    // Existing show spans midnight, new is normal
    else if (startTime < endTime && existingStart >= existingEnd) {
      if (existingStart < endTime || existingEnd > startTime) {
        return true;
      }
    }
    // Both span midnight — they always overlap if they share a day
    else {
      return true;
    }
  }

  return false;
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
): Promise<boolean> => {
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

    // Both normal
    if (startTime < endTime && existingStart < existingEnd) {
      if (startTime < existingEnd && endTime > existingStart) {
        return true;
      }
    }
    // New spans midnight, existing normal
    else if (startTime >= endTime && existingStart < existingEnd) {
      if (startTime < existingEnd || endTime > existingStart) {
        return true;
      }
    }
    // Existing spans midnight, new normal
    else if (startTime < endTime && existingStart >= existingEnd) {
      if (existingStart < endTime || existingEnd > startTime) {
        return true;
      }
    }
    // Both span midnight
    else {
      return true;
    }
  }

  return false;
};

const deactivateByStation = (stationId: string): Promise<{ modifiedCount: number }> => {
  return Show.updateMany(
    { station: stationId, isActive: true },
    { $set: { isActive: false } },
  ).then((result) => ({ modifiedCount: result.modifiedCount }));
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
  checkOverlap,
  checkPresenterOverlap,
  deactivateByStation,
};
