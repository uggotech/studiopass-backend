import { logger } from "../../logger/logger";
import { Station } from "../station/station.model";
import { ShowRepository } from "./show.repository";
import { checkAndEmitShowTransition } from "../../socket/index";
import Call from "../call/call.model";
import { CallService } from "../call/call.service";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

const STATION_PAGE_SIZE = 500;

type CurrentShow = { id: string; name: string } | null;

function getCurrentShowForStation(
  shows: Array<{ _id: any; name: string; days: string[]; startTime: string; endTime: string }>,
  timezone: string,
): CurrentShow {
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

  for (const show of shows) {
    if (show.startTime <= show.endTime) {
      // Normal show starting and ending today
      if (show.days.includes(dayOfWeek as any) && show.startTime <= currentTime && currentTime < show.endTime) {
        return { id: show._id.toString(), name: show.name };
      }
    } else {
      // Overnight show:
      // Active if started today and before midnight (currentTime >= startTime)
      if (show.days.includes(dayOfWeek as any) && currentTime >= show.startTime) {
        return { id: show._id.toString(), name: show.name };
      }
      // OR active if started yesterday and currently past midnight into today (currentTime < endTime)
      if (show.days.includes(yesterday as any) && currentTime < show.endTime) {
        return { id: show._id.toString(), name: show.name };
      }
    }
  }

  return null;
}

/**
 * Work out the current show of EVERY active station with a fixed number of queries
 * (one page of stations + one query for all their shows), instead of one query per station.
 */
async function computeCurrentShows(): Promise<Map<string, CurrentShow>> {
  const result = new Map<string, CurrentShow>();

  for (let skip = 0; ; skip += STATION_PAGE_SIZE) {
    const stations = await Station.find({ isActive: true })
      .select("_id country")
      .populate("country", "timezone")
      .sort({ _id: 1 })
      .skip(skip)
      .limit(STATION_PAGE_SIZE)
      .lean();

    if (stations.length === 0) break;

    const stationIds = stations.map((s) => (s._id as any).toString());
    const shows = await ShowRepository.findByStations(stationIds);

    const showsByStation = new Map<string, any[]>();
    for (const show of shows as any[]) {
      const key = (show.station as any)?.toString();
      if (!key) continue;
      const list = showsByStation.get(key);
      if (list) list.push(show);
      else showsByStation.set(key, [show]);
    }

    for (const station of stations) {
      const stationId = (station._id as any).toString();
      const timezone = (station.country as any)?.timezone || "UTC";
      result.set(stationId, getCurrentShowForStation(showsByStation.get(stationId) ?? [], timezone));
    }

    if (stations.length < STATION_PAGE_SIZE) break;
  }

  return result;
}

/**
 * End every queued / answered call that belongs to a show which is no longer on air
 * (the show ended, or a different show is on air now).
 *
 * It looks at the calls themselves instead of remembering "which show ended", so it also
 * cleans up after a server restart that happened during a show change.
 * Calls created after `computedAt` are left alone (they may belong to a show that started
 * right after the schedule was computed).
 */
async function endCallsOfFinishedShows(
  currentShows: Map<string, CurrentShow>,
  computedAt: Date,
): Promise<void> {
  const liveCalls = await Call.find({
    status: { $in: ["queued", "answered"] },
    startedAt: { $lt: computedAt },
  })
    .select("_id station show")
    .lean();

  for (const call of liveCalls) {
    const stationId = call.station.toString();
    if (!currentShows.has(stationId)) continue; // station not scheduled (inactive)

    const callShowId = call.show?.toString();
    if (!callShowId) continue; // call not tied to a show — leave it alone

    const current = currentShows.get(stationId) ?? null;
    if (current && current.id === callShowId) continue; // its show is still on air

    try {
      await CallService.endCallBySystem(call._id.toString(), "show_ended", "The show has ended.");
    } catch (err) {
      logger.error(`[ShowScheduler] Failed to end call ${call._id} after show end:`, err);
    }
  }
}

async function checkAllStations() {
  // A slow tick must never overlap the next one
  if (tickRunning) return;
  tickRunning = true;

  try {
    const computedAt = new Date();
    const currentShows = await computeCurrentShows();

    // 1) Calls of the finished show are ended (queue refunded) BEFORE anyone is told the new show started
    await endCallsOfFinishedShows(currentShows, computedAt);

    // 2) Announce show-ended / show-started (also drops the cached "active show")
    for (const [stationId, current] of currentShows) {
      try {
        await checkAndEmitShowTransition(stationId, current?.id ?? null, current?.name ?? null);
      } catch (err) {
        logger.error(`[ShowScheduler] Transition error for station ${stationId}:`, err);
      }
    }
  } catch (error) {
    logger.error("[ShowScheduler] Error checking stations:", error);
  } finally {
    tickRunning = false;
  }
}

export function startShowScheduler(intervalMs: number = 10000) {
  if (schedulerInterval) return;
  logger.info(`[ShowScheduler] Starting with ${intervalMs / 1000}s interval`);
  checkAllStations();
  schedulerInterval = setInterval(checkAllStations, intervalMs);
}

export function stopShowScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("[ShowScheduler] Stopped");
  }
}
