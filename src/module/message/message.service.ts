import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { MessageRepository } from "./message.repository";
import { ShowRepository } from "../show/show.repository";
import { CreditService } from "../credit/credit.service";
import { StationRepository } from "../station/station.repository";
import { Country } from "../country/country.model";
import { User } from "../user/user.model";
import { Notification } from "../notification/notification.model";
import { sendFirebaseNotification } from "../../util/firebasePushNotification";
import { emitToStation } from "../../socket";
import { ListenerStatementService } from "../listenerStatement/listenerStatement.service";

const sendUserMessage = async (
  stationId: string,
  content: string | undefined,
  userId: string,
  imageUrl?: string,
) => {
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  // Get the station's country timezone for show detection
  const country = await Country.findById(station.country).lean();
  const timezone = country?.timezone || "UTC";

  const activeShow = await ShowRepository.findActiveShowForStation(
    stationId,
    timezone,
  );
  if (!activeShow) {
    // Try to find the next upcoming show so the user knows when to come back
    const shows = await ShowRepository.findByStation(stationId);
    const now = new Date();
    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const timeParts = timeFormatter.formatToParts(now);
    const currentTime = `${timeParts.find((p) => p.type === "hour")?.value ?? "00"}:${timeParts.find((p) => p.type === "minute")?.value ?? "00"}`;
    const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" });
    const today = dateFormatter.format(now).toLowerCase();

    const upcoming = shows
      .filter((s) => s.days.includes(today as any) && s.startTime > currentTime)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const nextShow = upcoming[0];
    const hint = nextShow
      ? ` Next show "${nextShow.name}" starts at ${nextShow.startTime}.`
      : "";

    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `No active show right now.${hint} Please try again during show hours.`,
    );
  }

  const user = await User.findById(userId).lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }
  if (!user.phone) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Phone number required to send messages.",
    );
  }

  const message = await MessageRepository.createMessage({
    station: stationId,
    show: activeShow._id,
    senderType: "user",
    user: userId,
    msisdn: user.phone,
    content: content || '',
    imageUrl: imageUrl || undefined,
    status: "delivered",
    country: user.countryId,
  });

  // Deduct credits via CreditService (single code path for credit deduction)
  const { balance: remainingBalance } = await CreditService.deductCredits(
    userId,
    1,
    stationId,
    message._id.toString(),
    "message",
  );

  // Create listener statement for this interaction
  try {
    await ListenerStatementService.createStatementFromMessage(message._id.toString());
  } catch {
    // statement creation failure should not block the response
  }

  try {
    emitToStation(stationId, "new-message", {
      message: normalizeMessage(message, activeShow.name),
    });
  } catch {
    // socket failure should not block the response
  }

  return {
    message: normalizeMessage(message, activeShow.name),
    remainingBalance,
  };
};

const sendStationReply = async (
  stationId: string,
  content: string,
  senderUserId: string,
  msisdn: string,
  templateUsed?: string,
) => {
  const station = await StationRepository.findById(stationId);
  if (!station) {
    throw new AppError(StatusCodes.NOT_FOUND, "Station not found");
  }

  const message = await MessageRepository.createMessage({
    station: stationId,
    senderType: "station",
    senderUser: senderUserId,
    content,
    msisdn,
    templateUsed: templateUsed || undefined,
    status: "delivered",
  });

  const recentUserMsg = await MessageRepository.findThread(
    stationId,
    msisdn,
    0,
    1,
  );
  if (recentUserMsg.length > 0 && recentUserMsg[0]) {
    const showId = (recentUserMsg[0] as any).show;
    if (showId) {
      await MessageRepository.markAsReplied(
        stationId,
        msisdn,
        showId.toString(),
      );
    }
  }

  try {
    emitToStation(stationId, "new-message", {
      message: normalizeMessage(message),
    });
  } catch {
    // socket failure should not block the response
  }

  // Send push notification + create notification record
  try {
    const user = await User.findOne({ phone: msisdn });
    if (user) {
      const notificationTitle = `New reply from ${station?.name || "Station"}`;
      const notificationBody = content.substring(0, 100);
      const notificationData = {
        stationId,
        messageId: message._id.toString(),
        type: "reply",
      };

      // Create notification record in DB
      await Notification.create({
        user: user._id,
        type: "reply",
        title: notificationTitle,
        body: notificationBody,
        data: notificationData,
        deliveryStatus: "pending",
      });

      // Send FCM push notification
      if (user.fcmToken) {
        const result = await sendFirebaseNotification(user.fcmToken, {
          title: notificationTitle,
          body: notificationBody,
          data: notificationData,
        });
        // Update delivery status based on result
        if (result.successCount > 0) {
          await Notification.findOneAndUpdate(
            { user: user._id, type: "reply", "data.messageId": message._id.toString() },
            { deliveryStatus: "sent" },
          );
        }
      }
    }
  } catch (e) {
    console.error("Failed to send push notification:", e);
  }

  return normalizeMessage(message);
};

const getUserThread = async (
  stationId: string,
  msisdn: string,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const messages = await MessageRepository.findThread(
    stationId,
    msisdn,
    skip,
    limit,
  );

  return messages.map((msg) => normalizeMessage(msg, (msg.show as any)?.name));
};

const getStationThreads = async (
  stationId: string | undefined,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const threads = await MessageRepository.findThreadsByStation(
    stationId,
    skip,
    limit,
  );
  const total = await MessageRepository.countThreadsByStation(stationId);

  return {
    threads,
    meta: {
      page,
      limit,
      totalPage: Math.ceil(total / limit),
      total,
    },
  };
};

const normalizeMessage = (msg: any, showName?: string) => {
  return {
    id: msg._id,
    stationId: msg.station,
    showName: showName || msg.show?.name || null,
    senderType: msg.senderType,
    senderName: msg.senderUser?.fullName || null,
    content: msg.content,
    imageUrl: msg.imageUrl || null,
    msisdn: msg.msisdn || null,
    status: msg.status,
    isReplied: msg.isReplied,
    createdAt: msg.createdAt,
  };
};

export const MessageService = {
  sendUserMessage,
  sendStationReply,
  getUserThread,
  getStationThreads,
};
