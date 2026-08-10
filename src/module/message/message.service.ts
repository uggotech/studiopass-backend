import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { MessageRepository } from "./message.repository";
import Message from "./message.model";
import { Show } from "../show/show.model";
import { ShowRepository } from "../show/show.repository";
import { CreditService } from "../credit/credit.service";
import { StationRepository } from "../station/station.repository";
import { Country } from "../country/country.model";
import { User } from "../user/user.model";
import { NotificationService } from "../notification/notification.service";
import MessageTemplate from "../messageTemplate/messageTemplate.model";
import { emitToStation, emitToShow, emitToUser, checkAndEmitShowTransition } from "../../socket";
import { ListenerStatementService } from "../listenerStatement/listenerStatement.service";
import { maskMsisdn, shouldMaskMsisdn } from "../../shared/maskMsisdn";
import { logger } from "../../logger/logger";

// ─── Timezone Helper ───────────────────────────────────────────────────────
// Fetches the station's country timezone. Returns "UTC" on failure.

const getStationTimezone = async (stationId: string): Promise<string> => {
  try {
    const station = await StationRepository.findById(stationId);
    const countryId = (station?.country as any)?._id || station?.country;
    if (countryId) {
      const country = await Country.findById(countryId).select("timezone").lean();
      return (country as any)?.timezone || "UTC";
    }
  } catch (err) {
    logger.warn(`[Message] Failed to resolve timezone for station ${stationId}:`, err);
  }
  return "UTC";
};

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

  // Check station is active
  if (!station.isActive) {
    throw new AppError(StatusCodes.BAD_REQUEST, "This station is currently inactive.");
  }

  // Get the station's country timezone for show detection
  const countryId = (station.country as any)?._id || station.country;

  // Parallel lookups: country (for timezone) + user (independent)
  const [country, user] = await Promise.all([
    Country.findById(countryId).lean(),
    User.findById(userId).lean(),
  ]);
  const timezone = country?.timezone || "UTC";

  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }
  if (!user.phone) {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Phone number required to send messages.",
    );
  }

  // Channels don't have shows — skip show detection
  let activeShow: any = null;
  if (station.category !== "channel") {
    activeShow = await ShowRepository.findActiveShowForStation(
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
  }

  // TV stations require approval; radio/channel deliver immediately
  const messageStatus = station.category === "tv" ? "pending" : "delivered";

  // Use MongoDB transaction for atomicity: message + credit deduction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Create message (within transaction)
    const message = await MessageRepository.createMessage({
      station: stationId,
      show: activeShow?._id || undefined,
      senderType: "user",
      user: userId,
      msisdn: user.phone,
      content: content || '',
      imageUrl: imageUrl || undefined,
      status: messageStatus,
      country: user.countryId,
      creditsUsed: 1,
    }, session);

    // 2. Deduct credits via CreditService (handles isFree detection + transaction record)
    const { balance: updatedBalance, isFree } = await CreditService.deductCredits(
      userId,
      1,
      stationId,
      message._id.toString(),
      "message",
      session,
    );

    await session.commitTransaction();

    // Post-transaction: create listener statement (non-critical, outside transaction)
    try {
      await ListenerStatementService.createStatementFromMessage(message._id.toString(), isFree);
    } catch (e) {
      console.error("Listener statement creation failed:", e);
    }

    // Emit socket event for station staff to see new user messages (non-critical)
    // Uses "new-user-message" so clients can distinguish from station replies
    try {
      const normalized = normalizeMessage(message, activeShow?.name);
      emitToStation(stationId, "new-user-message", { message: normalized });
      emitToUser(userId, "new-message", { message: normalized });

      // Check if the active show transitioned (for show-started/show-ended events)
      if (activeShow) {
        checkAndEmitShowTransition(stationId, activeShow._id.toString(), activeShow.name);
      }
    } catch {
      // socket failure should not block the response
    }

    return {
      message: normalizeMessage(message, activeShow?.name),
      remainingBalance: updatedBalance,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
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

  // Presenter template restriction: presenters must use templates
  const sender = await User.findById(senderUserId).lean();
  if (sender?.role === "presenter") {
    if (templateUsed) {
      // Explicit template reference — validate it
      const template = await MessageTemplate.findById(templateUsed);
      if (!template) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Template not found.");
      }
      if (template.station.toString() !== stationId) {
        throw new AppError(StatusCodes.FORBIDDEN, "Template does not belong to this station.");
      }
      if (!template.isActive) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Template is no longer active.");
      }
      content = template.text;
    } else {
      // No template ID — check if the content matches any active template for this station
      const matchingTemplate = await MessageTemplate.findOne({
        station: stationId,
        isActive: true,
        text: content.trim(),
      });
      if (matchingTemplate) {
        templateUsed = matchingTemplate._id.toString();
        content = matchingTemplate.text;
      } else {
        throw new AppError(StatusCodes.BAD_REQUEST, "Presenters must use a template to reply.");
      }
    }
  }

  // Find the most recent user message to get the show context (sort desc = newest first)
  // Channels don't have shows — skip show context
  let showId: any = null;
  if (station.category !== "channel") {
    const recentUserMsg = await Message.findOne({
      station: stationId,
      msisdn,
      senderType: "user",
    }).sort({ createdAt: -1 }).lean();
    showId = recentUserMsg ? (recentUserMsg as any).show : null;
  }

  // Use transaction for atomicity: message creation + markAsReplied
  const session = await mongoose.startSession();
  session.startTransaction();

  let message;
  try {
    message = await MessageRepository.createMessage({
      station: stationId,
      show: showId || undefined,
      senderType: "station",
      senderUser: senderUserId,
      content,
      msisdn,
      templateUsed: templateUsed || undefined,
      status: "delivered",
    }, session);

    // Mark preceding user messages as replied (scoped to show if available)
    await MessageRepository.markAsReplied(stationId, msisdn, showId?.toString(), session);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  // Re-fetch with populated fields for response and socket emission
  let populatedMessage;
  try {
    populatedMessage = await Message.findById(message._id)
      .populate("senderUser", "fullName")
      .populate("show", "name")
      .lean();
  } catch {
    // populate failure — fall back to unpopulated message
  }

  // Consolidate user lookups — single query for both socket + notification
  let listenerUser: any = null;
  try {
    listenerUser = await User.findOne({ phone: msisdn }).select("_id fcmToken").lean();
  } catch {
    // user lookup failure should not block the response
  }

  try {
    const normalized = normalizeMessage(populatedMessage || message);
    emitToStation(stationId, "new-message", { message: normalized });
    if (showId) {
      emitToShow(showId.toString(), "new-message", { message: normalized });
    }

    // Also emit to the listener's user room for real-time delivery
    if (listenerUser) {
      emitToUser(listenerUser._id.toString(), "new-message", { message: normalized });
    }
  } catch {
    // socket failure should not block the response
  }

  // Send push notification + create notification record (socket + FCM)
  try {
    if (listenerUser) {
      await NotificationService.createNotification({
        userId: listenerUser._id.toString(),
        type: "reply",
        title: `New reply from ${station?.name || "Station"}`,
        body: content.substring(0, 100),
        data: {
          stationId,
          messageId: message._id.toString(),
          showName: (populatedMessage?.show as any)?.name || null,
        },
      });
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
  const [messages, total, stationTimezone] = await Promise.all([
    MessageRepository.findThread(stationId, msisdn, skip, limit),
    Message.countDocuments({ station: stationId, msisdn }).lean(),
    getStationTimezone(stationId),
  ]);

  return {
    messages: messages.map((msg) => normalizeMessage(msg, (msg.show as any)?.name)),
    stationTimezone,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
  };
};

const getStationThreads = async (
  stationId: string | undefined,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const [threads, total, stationTimezone] = await Promise.all([
    MessageRepository.findThreadsByStation(stationId, skip, limit),
    MessageRepository.countThreadsByStation(stationId),
    stationId ? getStationTimezone(stationId) : Promise.resolve("UTC"),
  ]);

  return {
    threads,
    stationTimezone,
    meta: {
      page,
      limit,
      totalPage: Math.ceil(total / limit),
      total,
    },
  };
};

const getPresenterThreads = async (
  stationId: string,
  presenterId: string,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const [threads, total, stationTimezone] = await Promise.all([
    MessageRepository.findThreadsByPresenter(stationId, presenterId, skip, limit),
    MessageRepository.countThreadsByPresenter(stationId, presenterId),
    getStationTimezone(stationId),
  ]);

  return {
    threads,
    stationTimezone,
    meta: {
      page,
      limit,
      totalPage: Math.ceil(total / limit),
      total,
    },
  };
};

const getUserThreads = async (
  phone: string,
  userId: string,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const threads = await MessageRepository.findThreadsByUserPhone(
    phone,
    userId,
    skip,
    limit,
  );
  const total = await MessageRepository.countThreadsByUserPhone(phone);

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
    senderName: msg.senderType === "station"
      ? msg.senderUser?.fullName || null
      : msg.user?.fullName || msg.msisdn || null,
    userAvatar: msg.user?.avatar || null,
    content: msg.content,
    imageUrl: msg.imageUrl || null,
    msisdn: msg.msisdn || null,
    country: msg.country?.name || msg.country || null,
    operator: msg.operator || null,
    status: msg.status,
    isReplied: msg.isReplied,
    isRead: msg.isRead ?? false,
    createdAt: msg.createdAt,
  };
};

// ─── TV Approval Flow ───────────────────────────────────────────────────────

const findMessageForAuth = (messageId: string) => {
  return MessageRepository.findMessageById(messageId);
};

const approveMessage = async (messageId: string, approvedBy: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) {
    throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
  }
  if (message.status !== "pending") {
    throw new AppError(StatusCodes.BAD_REQUEST, `Cannot approve message with status "${message.status}". Only pending messages can be approved.`);
  }

  const updated = await MessageRepository.approveMessage(messageId, approvedBy);

  // Emit real-time update to station staff
  try {
    const normalized = normalizeMessage(updated);
    emitToStation((message as any).station?.toString(), "message-approved", { message: normalized });
  } catch {}

  return normalizeMessage(updated);
};

const rejectMessage = async (messageId: string, rejectionReason: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) {
    throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
  }
  if (message.status !== "pending") {
    throw new AppError(StatusCodes.BAD_REQUEST, `Cannot reject message with status "${message.status}". Only pending messages can be rejected.`);
  }

  const updated = await MessageRepository.rejectMessage(messageId, rejectionReason);

  // Emit real-time update to station staff
  try {
    const normalized = normalizeMessage(updated);
    emitToStation((message as any).station?.toString(), "message-rejected", { message: normalized });
  } catch {}

  return normalizeMessage(updated);
};

const sendToOutput = async (messageId: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) {
    throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
  }
  if (message.status !== "approved") {
    throw new AppError(StatusCodes.BAD_REQUEST, `Cannot send to output with status "${message.status}". Only approved messages can be sent to output.`);
  }

  const updated = await MessageRepository.sendToOutput(messageId);

  // Emit real-time update to station staff
  try {
    const normalized = normalizeMessage(updated);
    const stationId = (message as any).station?.toString();
    emitToStation(stationId, "message-sent-to-output", { message: normalized });
    if ((message as any).show) {
      emitToShow((message as any).show.toString(), "message-sent-to-output", { message: normalized });
    }
  } catch {}

  return normalizeMessage(updated);
};

const deleteMessage = async (messageId: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) {
    throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
  }
  await MessageRepository.deleteMessage(messageId);
};

const markAsRead = async (messageId: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) {
    throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
  }
  if ((message as any).isRead) return normalizeMessage(message);

  const updated = await MessageRepository.markAsRead(messageId);
  return normalizeMessage(updated);
};

const getMessageById = async (messageId: string) => {
  const message = await MessageRepository.findMessageById(messageId);
  if (!message) {
    throw new AppError(StatusCodes.NOT_FOUND, "Message not found");
  }
  return normalizeMessage(message, (message.show as any)?.name);
};

const getPendingMessages = async (
  stationId: string,
  page: number,
  limit: number,
  options?: { search?: string; type?: string; timeRange?: string },
) => {
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {
    senderType: "user",
    status: { $in: ["pending", "approved"] },
    isDeleted: { $ne: true },
  };

  if (stationId) {
    filter.station = stationId;
  }

  // Type filter
  if (options?.type === "text") {
    filter.$or = [
      { imageUrl: { $exists: false } },
      { imageUrl: null },
      { imageUrl: "" },
    ];
  } else if (options?.type === "image") {
    filter.imageUrl = { $exists: true, $ne: null, $nin: ["", null] };
  }

  // Time Range filter
  if (options?.timeRange && options.timeRange !== "all") {
    const now = new Date();
    if (options.timeRange === "today") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      filter.createdAt = { $gte: startOfDay };
    } else if (options.timeRange === "7days") {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filter.createdAt = { $gte: sevenDaysAgo };
    } else if (options.timeRange === "30days") {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      filter.createdAt = { $gte: thirtyDaysAgo };
    }
  }

  // Search filter
  if (options?.search?.trim()) {
    const searchRegex = new RegExp(options.search.trim(), "i");
    const searchCondition = [
      { content: searchRegex },
      { msisdn: searchRegex },
    ];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchCondition }];
      delete filter.$or;
    } else {
      filter.$or = searchCondition;
    }
  }

  const messages = await Message.find(filter)
    .populate("show", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Message.countDocuments(filter);

  return {
    messages: messages.map((m) => normalizeMessage(m, (m.show as any)?.name)),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const exportMessages = async (
  stationId: string | undefined,
  format: string,
  role?: string,
) => {
  const filter: Record<string, unknown> = { senderType: "user", isDeleted: { $ne: true } };
  if (stationId) filter.station = stationId;

  const messages = await Message.find(filter)
    .populate("show", "name")
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean();

  const shouldMask = role ? shouldMaskMsisdn(role) : false;

  const rows = messages.map((m) => ({
    id: m._id,
    msisdn: shouldMask ? maskMsisdn(m.msisdn || "") : m.msisdn,
    content: m.content,
    station: (m.station as any)?.toString(),
    show: (m.show as any)?.name || "",
    status: m.status,
    createdAt: m.createdAt,
  }));

  if (format === "csv") {
    const header = "ID,MSISDN,Content,Station,Show,Created\n";
    const csv = rows.map((r) =>
      `"${r.id}","${r.msisdn}","${(r.content || "").replace(/"/g, '""')}","${r.station}","${r.show}","${r.createdAt}"`
    ).join("\n");
    return { format: "csv", data: header + csv };
  }

  return { format: "json", data: rows };
};

const searchMessages = async (
  query: string,
  stationId: string | undefined,
  page: number,
  limit: number,
) => {
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};

  if (stationId) filter.station = stationId;

  // Use regex for content search (works without text index)
  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.content = new RegExp(escaped, "i");
  }

  const [messages, total] = await Promise.all([
    Message.find(filter)
      .populate("show", "name")
      .populate("senderUser", "fullName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Message.countDocuments(filter),
  ]);

  return {
    messages: messages.map((m) => normalizeMessage(m, (m.show as any)?.name)),
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

const getAllMessages = async (
  stationId: string | undefined,
  page: number,
  limit: number,
  filters?: {
    country?: string;
    show?: string;
    status?: string;
    search?: string;
  },
) => {
  const skip = (page - 1) * limit;
  const filter: Record<string, unknown> = {};
  if (stationId) filter.station = stationId;

  if (filters?.country) {
    if (mongoose.Types.ObjectId.isValid(filters.country)) {
      filter.country = new mongoose.Types.ObjectId(filters.country);
    }
  }

  if (filters?.show) {
    if (mongoose.Types.ObjectId.isValid(filters.show)) {
      filter.show = new mongoose.Types.ObjectId(filters.show);
    } else {
      const showDoc = await Show.findOne({ name: new RegExp(filters.show, "i") }).select("_id").lean();
      if (showDoc) filter.show = showDoc._id;
    }
  }

  if (filters?.status) {
    filter.status = filters.status.toLowerCase();
  }

  if (filters?.search) {
    const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    filter.$or = [
      { content: searchRegex },
      { msisdn: searchRegex },
    ];
  }

  const [messages, total, stationTimezone] = await Promise.all([
    MessageRepository.findAllMessages(filter, skip, limit),
    MessageRepository.countAllMessages(filter),
    stationId ? getStationTimezone(stationId) : Promise.resolve("UTC"),
  ]);

  return {
    messages: messages.map((m) => normalizeMessage(m, (m.show as any)?.name)),
    stationTimezone,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

export const MessageService = {
  sendUserMessage,
  sendStationReply,
  getUserThread,
  getStationThreads,
  getPresenterThreads,
  getUserThreads,
  findMessageForAuth,
  getMessageById,
  approveMessage,
  rejectMessage,
  sendToOutput,
  deleteMessage,
  markAsRead,
  getPendingMessages,
  exportMessages,
  searchMessages,
  getAllMessages,
};
