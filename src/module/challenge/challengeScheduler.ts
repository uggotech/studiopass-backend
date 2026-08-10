import { Challenge } from "./challenge.model";
import { ChannelPoll } from "../channelPoll/channelPoll.model";
import { DisbursementService } from "../disbursement/disbursement.service";
import { logger } from "../../logger/logger";

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

async function checkChallengeStatusTransitions() {
  try {
    const activeAndScheduled = await Challenge.find({
      status: { $in: ["scheduled", "active", "draft"] },
    }).populate("station");

    for (const challenge of activeAndScheduled) {
      const stationDoc = challenge.station as any;
      const timezone = stationDoc?.country?.timezone || "UTC";

      const { currentDateStr, currentTimeStr } = getStationLocalDateTime(timezone);

      const startDateObj = challenge.startDate ? new Date(challenge.startDate) : new Date();
      const endDateObj = challenge.endDate ? new Date(challenge.endDate) : new Date();

      const challengeStartDateStr = startDateObj.toISOString().split("T")[0];
      const challengeEndDateStr = endDateObj.toISOString().split("T")[0];

      const startDateTimeStr = `${challengeStartDateStr}T${challenge.startTime || "00:00"}`;
      const endDateTimeStr = `${challengeEndDateStr}T${challenge.endTime || "23:59"}`;
      const currentDateTimeStr = `${currentDateStr}T${currentTimeStr}`;

      if (
        (challenge.status === "scheduled" || challenge.status === "draft") &&
        currentDateTimeStr >= startDateTimeStr &&
        currentDateTimeStr < endDateTimeStr
      ) {
        await Challenge.findByIdAndUpdate(challenge._id, { status: "active" });
        logger.info(`[ChallengeScheduler] Challenge ${challenge._id} (${challenge.title}) activated.`);
      }

      if (challenge.status === "active" && currentDateTimeStr >= endDateTimeStr) {
        const updated = await Challenge.findOneAndUpdate(
          { _id: challenge._id, status: "active" },
          { $set: { status: "completed" } },
          { new: true },
        );

        if (updated) {
          logger.info(`[ChallengeScheduler] Challenge ${challenge._id} (${challenge.title}) completed. Triggering disbursements.`);
          await DisbursementService.createDisbursementsForChallenge(String(challenge._id));
        }
      }
    }

    // Check ChannelPoll status transitions
    const activeAndScheduledPolls = await ChannelPoll.find({
      status: { $in: ["draft", "active"] },
    });
    const now = new Date();
    for (const poll of activeAndScheduledPolls) {
      if (poll.status === "draft" && poll.startDate && new Date(poll.startDate) <= now && new Date(poll.endDate) > now) {
        await ChannelPoll.findByIdAndUpdate(poll._id, { status: "active" });
        logger.info(`[ChallengeScheduler] ChannelPoll ${poll._id} (${poll.title}) activated.`);
      } else if (poll.status === "active" && poll.endDate && new Date(poll.endDate) <= now) {
        await ChannelPoll.findByIdAndUpdate(poll._id, { status: "completed" });
        logger.info(`[ChallengeScheduler] ChannelPoll ${poll._id} (${poll.title}) completed.`);
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
