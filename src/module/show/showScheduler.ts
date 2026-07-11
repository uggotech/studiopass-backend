import { logger } from "../../logger/logger";
import { StationRepository } from "../station/station.repository";
import { ShowRepository } from "./show.repository";
import { checkAndEmitShowTransition } from "../../socket/index";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

function getCurrentShowForStation(
  shows: Array<{ _id: any; name: string; days: string[]; startTime: string; endTime: string }>,
  timezone: string,
): { id: string; name: string } | null {
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

  for (const show of shows) {
    if (!show.days.includes(dayOfWeek as any)) continue;

    if (show.startTime <= show.endTime) {
      if (show.startTime <= currentTime && currentTime < show.endTime) {
        return { id: show._id.toString(), name: show.name };
      }
    } else {
      if (currentTime >= show.startTime || currentTime < show.endTime) {
        return { id: show._id.toString(), name: show.name };
      }
    }
  }

  return null;
}

async function checkAllStations() {
  try {
    const stations = await StationRepository.findAll({ isActive: true }, { limit: 500 });

    for (const station of stations) {
      const stationId = (station._id as any).toString();
      const country = station.country as any;
      const timezone = country?.timezone || "UTC";

      const shows = await ShowRepository.findByStation(stationId);
      const currentShow = getCurrentShowForStation(shows as any, timezone);

      // Use the unified state tracker from socket/index.ts
      // This prevents duplicate/conflicting show-started/show-ended events
      // because both the scheduler and message flow share the same lastActiveShow map
      checkAndEmitShowTransition(
        stationId,
        currentShow?.id ?? null,
        currentShow?.name ?? null,
      );
    }
  } catch (error) {
    logger.error("[ShowScheduler] Error checking stations:", error);
  }
}

export function startShowScheduler(intervalMs: number = 60000) {
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
