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
    days: dayOfWeek,
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
  const overlapping = await Show.findOne({
    station: stationId,
    isActive: true,
    days: { $in: days },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  }).lean();
  return !!overlapping;
};

const findByPresenter = (presenterId: string): Promise<TShow[]> => {
  return Show.find({ presenter: presenterId, isActive: true })
    .populate("station", "name stationCode category country")
    .populate("presenter", "fullName avatar")
    .sort({ startTime: 1 })
    .lean();
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
};
