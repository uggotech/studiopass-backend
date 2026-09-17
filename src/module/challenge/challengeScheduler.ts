import { Challenge } from "./challenge.model";
import { ChannelPoll } from "../channelPoll/channelPoll.model";
import { DisbursementService } from "../disbursement/disbursement.service";
import { NotificationService } from "../notification/notification.service";
import { Follow } from "../follow/follow.model";
import { logger } from "../../logger/logger";
import { normalizeHhMm, zonedDateTimeToUtc } from "./challengeTime";

let challengeInterval: ReturnType<typeof setInterval> | null = null;

function getStationLocalDateTime(timezone: string): { currentDateStr: string; currentTimeStr: string } {
  const now = new Date();
  const tz = timezone || "UTC";

  try {
    const dateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const currentDateStr = dateFormatter.format(now);

    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const timeParts = timeFormatter.formatToParts(now);
    const hour = timeParts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
    const currentTimeStr = `${hour}:${minute}`;

    return { currentDateStr, currentTimeStr };
  } catch {
    const iso = now.toISOString();
    const currentDateStr = iso.substring(0, 10);
    const currentTimeStr = iso.substring(11, 16);
    return { currentDateStr, currentTimeStr };
  }
}

function formatCalendarInTz(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Resolve startsAt/endsAt for legacy rows and persist once (backfill). */
async function ensureUtcWindow(
  challenge: any,
  timezone: string,
): Promise<{ startsAt: Date; endsAt: Date } | null> {
  const hasStart = challenge.startsAt instanceof Date || typeof challenge.startsAt === "string";
  const hasEnd = challenge.endsAt instanceof Date || typeof challenge.endsAt === "string";

  if (hasStart && hasEnd) {
    return {
      startsAt: new Date(challenge.startsAt),
      endsAt: new Date(challenge.endsAt),
    };
  }

  try {
    const startDateStr = challenge.startDate
      ? formatCalendarInTz(new Date(challenge.startDate), timezone)
      : null;
    const endDateStr = challenge.endDate
      ? formatCalendarInTz(new Date(challenge.endDate), timezone)
      : null;
    if (!startDateStr || !endDateStr) return null;

    const startTime = normalizeHhMm(challenge.startTime);
    const endTime = normalizeHhMm(challenge.endTime);
    const startsAt = zonedDateTimeToUtc(startDateStr, startTime, timezone);
    const endsAt = zonedDateTimeToUtc(endDateStr, endTime, timezone);

    await Challenge.updateOne(
      { _id: challenge._id },
      { $set: { startsAt, endsAt, startDate: startsAt, endDate: endsAt, startTime, endTime } },
    );
    challenge.startsAt = startsAt;
    challenge.endsAt = endsAt;
    return { startsAt, endsAt };
  } catch (err) {
    logger.error(`[ChallengeScheduler] Failed to backfill UTC window for ${challenge._id}:`, err);
    return null;
  }
}

/** Legacy string compare — only when UTC window cannot be resolved. */
function legacyIsInWindow(
  challenge: any,
  timezone: string,
): { shouldActivate: boolean; shouldComplete: boolean } {
  const { currentDateStr, currentTimeStr } = getStationLocalDateTime(timezone);
  const startDateObj = challenge.startDate ? new Date(challenge.startDate) : new Date();
  const endDateObj = challenge.endDate ? new Date(challenge.endDate) : new Date();
  const challengeStartDateStr = formatCalendarInTz(startDateObj, timezone);
  const challengeEndDateStr = formatCalendarInTz(endDateObj, timezone);
  const startDateTimeStr = `${challengeStartDateStr}T${normalizeHhMm(challenge.startTime)}`;
  const endDateTimeStr = `${challengeEndDateStr}T${normalizeHhMm(challenge.endTime)}`;
  const currentDateTimeStr = `${currentDateStr}T${currentTimeStr}`;

  return {
    shouldActivate:
      challenge.status === "scheduled" &&
      currentDateTimeStr >= startDateTimeStr &&
      currentDateTimeStr < endDateTimeStr,
    shouldComplete: challenge.status === "active" && currentDateTimeStr >= endDateTimeStr,
  };
}

async function completeChallenge(challengeId: string, title: string) {
  const updated = await Challenge.findOneAndUpdate(
    { _id: challengeId, status: "active" },
    { $set: { status: "completed" } },
    { returnDocument: "after" },
  );
  if (updated) {
    logger.info(
      `[ChallengeScheduler] Challenge ${challengeId} (${title}) completed. Triggering disbursements.`,
    );
    await DisbursementService.createDisbursementsForChallenge(String(challengeId));
  }
}

async function activateChallenge(challenge: any) {
  await Challenge.findByIdAndUpdate(challenge._id, { status: "active" });
  logger.info(
    `[ChallengeScheduler] Challenge ${challenge._id} (${challenge.title}) activated.`,
  );

  try {
    const stationId = (challenge.station as any)?._id || challenge.station;
    const follows = await Follow.find({
      station: stationId,
      notificationsEnabled: true,
    })
      .select("user")
      .lean();
    const followerIds = follows.map((f) => f.user.toString());
    if (followerIds.length > 0) {
      await NotificationService.sendBulkNotifications(
        followerIds,
        "New Challenge Available!",
        `A new challenge "${challenge.title}" is now active. Tap to participate!`,
        "announcement",
        {
          challengeId: String(challenge._id),
          kind: "challenge_start",
          type: "challenge_start",
          route: `/challenge-result/${challenge._id}`,
        },
      );
      logger.info(
        `[ChallengeScheduler] Sent ${followerIds.length} notifications for challenge ${challenge._id}.`,
      );
    }
  } catch (err) {
    logger.error(`[ChallengeScheduler] Error sending challenge start notifications:`, err);
  }
}

async function checkChallengeStatusTransitions() {
  try {
    const activeAndScheduled = await Challenge.find({
      status: { $in: ["scheduled", "active"] },
    }).populate({ path: "station", populate: { path: "country", select: "timezone" } });

    const now = new Date();

    for (const challenge of activeAndScheduled) {
      const stationDoc = challenge.station as any;
      const timezone = stationDoc?.country?.timezone || "UTC";

      const window = await ensureUtcWindow(challenge, timezone);

      if (window) {
        // Channel-poll model: exact UTC instants
        if (
          challenge.status === "scheduled" &&
          now >= window.startsAt &&
          now < window.endsAt
        ) {
          await activateChallenge(challenge);
        }
        if (challenge.status === "active" && now >= window.endsAt) {
          await completeChallenge(challenge._id.toString(), challenge.title);
        }
        continue;
      }

      // Legacy fallback (should disappear after backfill)
      const { shouldActivate, shouldComplete } = legacyIsInWindow(challenge, timezone);
      if (shouldActivate) {
        await activateChallenge(challenge);
      }
      if (shouldComplete) {
        await completeChallenge(challenge._id.toString(), challenge.title);
      }
    }

    // ChannelPoll status transitions (already UTC Dates)
    const activeAndScheduledPolls = await ChannelPoll.find({
      status: { $in: ["draft", "scheduled", "active"] },
    });
    const activatedChannelPollIds: string[] = [];
    for (const poll of activeAndScheduledPolls) {
      if (
        (poll.status === "draft" || poll.status === "scheduled") &&
        poll.startDate &&
        new Date(poll.startDate) <= now &&
        new Date(poll.endDate) > now
      ) {
        await ChannelPoll.findByIdAndUpdate(poll._id, { status: "active" });
        logger.info(`[ChallengeScheduler] ChannelPoll ${poll._id} (${poll.title}) activated.`);
        activatedChannelPollIds.push(String(poll._id));
      } else if (poll.status === "active" && poll.endDate && new Date(poll.endDate) <= now) {
        await ChannelPoll.findByIdAndUpdate(poll._id, { status: "completed" });
        logger.info(`[ChallengeScheduler] ChannelPoll ${poll._id} (${poll.title}) completed.`);
      }
    }

    for (const pollId of activatedChannelPollIds) {
      try {
        const full: any = await ChannelPoll.findById(pollId).populate("station", "name").lean();
        if (!full?.station) continue;
        const stationId = full.station._id || full.station;
        const follows = await Follow.find({
          station: stationId,
          notificationsEnabled: true,
        })
          .select("user")
          .lean();
        const followerIds = follows.map((f: any) => String(f.user));
        if (followerIds.length === 0) continue;
        const stationName = full.station.name || "the channel";
        await NotificationService.sendBulkNotifications(
          followerIds,
          "New Channel Poll",
          `Voting is open: "${full.title}" on ${stationName}.`,
          "announcement",
          {
            stationId: String(stationId),
            channelPollId: pollId,
            type: "channel_poll",
            kind: "channel_poll",
            route: `/channel-polls/${pollId}`,
          },
        );
      } catch (err) {
        logger.error("[ChallengeScheduler] Channel poll activate notify failed", err);
      }
    }
  } catch (error) {
    logger.error("[ChallengeScheduler] Error running challenge scheduler:", error);
  }
}

export function startChallengeScheduler(intervalMs: number = 60000) {
  if (challengeInterval) return;
  checkChallengeStatusTransitions();
  challengeInterval = setInterval(checkChallengeStatusTransitions, intervalMs);
  logger.info(`[ChallengeScheduler] Challenge scheduler started with interval ${intervalMs}ms`);
}

export function stopChallengeScheduler() {
  if (challengeInterval) {
    clearInterval(challengeInterval);
    challengeInterval = null;
    logger.info("[ChallengeScheduler] Challenge scheduler stopped.");
  }
}
