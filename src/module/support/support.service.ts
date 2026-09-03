import { Types, isValidObjectId } from "mongoose";
import StatusCodes from "http-status-codes";
import AppError from "../../errors/AppError";
import { SupportRepository } from "./support.repository";
import { SupportConversation } from "./support.model";
import { ISupportConversation, ISupportMessage } from "./support.interface";
import { User } from "../user/user.model";
import { TUser } from "../user/user.interface";
import { CreditTransaction } from "../creditTransaction/creditTransaction.model";
import ListenerStatement from "../listenerStatement/listenerStatement.model";
import { Station } from "../station/station.model";
import { NotificationService } from "../notification/notification.service";
import { getIO } from "../../socket";

const generateTicketId = (): string => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomStr = Math.floor(1000 + Math.random() * 9000).toString();
  return `TKT-${dateStr}-${randomStr}`;
};

export const SupportService = {
  async createConversation(userId: string, initialMessage: string): Promise<{ conversation: ISupportConversation; firstMessage: ISupportMessage }> {
    const user = await User.findById(userId).lean();
    if (!user) {
      throw new AppError(StatusCodes.NOT_FOUND, "User not found");
    }

    // Check if user already has an active OPEN or ASSIGNED conversation
    let conversation = await SupportRepository.findActiveByUserId(userId);

    if (!conversation) {
      const ticketId = generateTicketId();
      conversation = await SupportRepository.createConversation({
        ticketId,
        userId: new Types.ObjectId(userId),
        countryId: user.countryId ? new Types.ObjectId(user.countryId) : undefined,
        status: "OPEN",
        lastMessage: initialMessage,
        lastMessageAt: new Date(),
        unreadCountAgent: 1,
        unreadCountUser: 0,
      });

      // Refetch populated conversation
      conversation = (await SupportRepository.findById(conversation._id))!;
    } else {
      // Update existing active conversation with latest message
      await SupportConversation.findByIdAndUpdate(conversation._id, {
        lastMessage: initialMessage,
        lastMessageAt: new Date(),
        $inc: { unreadCountAgent: 1 },
      });
    }

    // Create the initial support message
    const firstMessage = await SupportRepository.createMessage({
      conversationId: conversation._id,
      senderId: new Types.ObjectId(userId),
      senderRole: "user",
      senderName: user.fullName || "App User",
      message: initialMessage,
    });

    // Real-time socket notification to support agents
    try {
      const io = getIO();
      if (io) {
        const countryRoom = user.countryId ? `support_queue:${user.countryId}` : null;
        io.to("support_queue:global").emit("new-ticket-conversation", { conversation, firstMessage });
        if (countryRoom) {
          io.to(countryRoom).emit("new-ticket-conversation", { conversation, firstMessage });
        }
        io.to(`conversation:${conversation._id}`).emit("new-support-message", firstMessage);
      }
    } catch (e) {
      // Socket emission failure shouldn't fail request
    }

    return { conversation, firstMessage };
  },

  async getActiveUserConversation(userId: string): Promise<ISupportConversation | null> {
    return SupportRepository.findActiveByUserId(userId);
  },

  async getUnassignedQueue(
    query: Record<string, unknown>,
    agent: { countryId?: Types.ObjectId; scopeType?: string },
  ) {
    const filter: Record<string, unknown> = { status: "OPEN" };

    if (agent.scopeType === "country" && agent.countryId) {
      filter.countryId = agent.countryId;
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      SupportConversation.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName avatar email phone countryId")
        .populate("countryId", "name code flag")
        .lean(),
      SupportConversation.countDocuments(filter),
    ]);

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
    };
  },

  async getMyClaimedTickets(query: Record<string, unknown>, agentId: string) {
    const filter: Record<string, unknown> = {
      assignedAgentId: new Types.ObjectId(agentId),
      status: "ASSIGNED",
    };

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      SupportConversation.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName avatar email phone countryId")
        .populate("countryId", "name code flag")
        .lean(),
      SupportConversation.countDocuments(filter),
    ]);

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
    };
  },

  async getClosedTickets(
    query: Record<string, unknown>,
    agent: { countryId?: Types.ObjectId; scopeType?: string },
  ) {
    const filter: Record<string, unknown> = { status: "CLOSED" };

    if (agent.scopeType === "country" && agent.countryId) {
      filter.countryId = agent.countryId;
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      SupportConversation.find(filter)
        .sort({ closedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName avatar email phone countryId")
        .populate("assignedAgentId", "fullName email avatar")
        .populate("countryId", "name code flag")
        .lean(),
      SupportConversation.countDocuments(filter),
    ]);

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPage: Math.ceil(total / limit),
      },
    };
  },

  async getConversationMessages(conversationId: string, page = 1, limit = 100) {
    const conversation = await SupportRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError(StatusCodes.NOT_FOUND, "Conversation not found");
    }

    const messages = await SupportRepository.findMessagesByConversationId(conversationId, page, limit);

    return {
      conversation,
      messages,
    };
  },

  async claimTicket(conversationId: string, agentId: string) {
    const conversation = await SupportRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError(StatusCodes.NOT_FOUND, "Conversation not found");
    }

    if (conversation.status !== "OPEN") {
      throw new AppError(StatusCodes.BAD_REQUEST, `Ticket is already ${conversation.status}`);
    }

    const updated = await SupportRepository.updateConversationStatus(conversationId, "ASSIGNED", {
      assignedAgentId: new Types.ObjectId(agentId),
    });

    try {
      const io = getIO();
      if (io) {
        io.to(`conversation:${conversationId}`).emit("ticket-status-changed", {
          conversationId,
          status: "ASSIGNED",
          assignedAgentId: agentId,
        });
      }
    } catch {
      // socket error silent
    }

    return updated;
  },

  async closeTicket(conversationId: string, closedByUserId: string) {
    const conversation = await SupportRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError(StatusCodes.NOT_FOUND, "Conversation not found");
    }

    if (conversation.status === "CLOSED") {
      return conversation;
    }

    const updated = await SupportRepository.updateConversationStatus(conversationId, "CLOSED", {
      closedAt: new Date(),
      closedBy: new Types.ObjectId(closedByUserId),
    });

    try {
      const io = getIO();
      if (io) {
        io.to(`conversation:${conversationId}`).emit("ticket-status-changed", {
          conversationId,
          status: "CLOSED",
        });
      }
    } catch {
      // socket error silent
    }

    return updated;
  },

  async sendMessage(
    conversationId: string,
    sender: { _id: Types.ObjectId; fullName?: string; role: string },
    messageText: string,
    attachments?: string[],
  ): Promise<ISupportMessage> {
    const conversation = await SupportRepository.findById(conversationId);
    if (!conversation) {
      throw new AppError(StatusCodes.NOT_FOUND, "Conversation not found");
    }

    if (conversation.status === "CLOSED") {
      throw new AppError(StatusCodes.BAD_REQUEST, "Cannot send message to a closed ticket");
    }

    const isAgent = ["customer_care", "super_admin", "partner_admin"].includes(sender.role);
    const senderRole = isAgent ? (sender.role as any) : "user";

    const supportMsg = await SupportRepository.createMessage({
      conversationId: new Types.ObjectId(conversationId),
      senderId: sender._id,
      senderRole,
      senderName: sender.fullName || (isAgent ? "Customer Care Agent" : "App User"),
      message: messageText,
      attachments: attachments || [],
    });

    // Update conversation metadata & unread counters
    const updateData: Partial<ISupportConversation> = {
      lastMessage: messageText,
      lastMessageAt: new Date(),
    };

    if (isAgent) {
      updateData.unreadCountUser = (conversation.unreadCountUser || 0) + 1;
      updateData.unreadCountAgent = 0;
    } else {
      updateData.unreadCountAgent = (conversation.unreadCountAgent || 0) + 1;
      updateData.unreadCountUser = 0;
    }

    await SupportConversation.findByIdAndUpdate(conversationId, updateData);

    // Socket emission to active room & direct user room
    try {
      const io = getIO();
      if (io) {
        io.to(`conversation:${conversationId}`).emit("new-support-message", supportMsg);
        io.to(`user:${conversation.userId._id.toString()}`).emit("new-support-message", supportMsg);
      }
    } catch {
      // socket fail non-blocking
    }

    // If sent by an agent, send FCM push notification to listener
    if (isAgent && conversation.userId) {
      try {
        await NotificationService.createNotification({
          userId: conversation.userId._id.toString(),
          type: "reply",
          title: "Customer Support Reply",
          body: messageText.length > 80 ? `${messageText.slice(0, 80)}...` : messageText,
          data: {
            conversationId,
            ticketId: conversation.ticketId,
          },
        });
      } catch {
        // notification non-blocking
      }
    }

    return supportMsg;
  },

  async searchEntities(
    queryStr: string,
    agent: any,
  ) {
    if (!queryStr || queryStr.trim().length === 0) {
      return { users: [], transactions: [], statements: [], stations: [] };
    }

    const trimmed = queryStr.trim();
    const isObjectId = isValidObjectId(trimmed);
    const regex = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    // Role-based scoping
    const isStationAdmin = agent?.role === "station_admin" || agent?.role === "media_station" || agent?.role === "presenter";
    const isPartnerAdmin = agent?.role === "partner_admin";

    let userScope: Record<string, unknown> = {};
    let stationScope: Record<string, unknown> = {};
    let txScope: Record<string, unknown> = {};
    let stScope: Record<string, unknown> = {};

    if (isStationAdmin && agent?.stationId) {
      const sid = new Types.ObjectId(agent.stationId.toString());
      userScope = { stationId: sid };
      stationScope = { _id: sid };
      txScope = { station: sid };
      stScope = { station: sid };
    } else if (isPartnerAdmin && agent?.partnerId) {
      const pid = agent.partnerId.toString();
      const partnerOid = new Types.ObjectId(pid);
      const partnerStations = await Station.find({ partner: partnerOid }).select("_id").lean();
      const sids = partnerStations.map((s) => s._id);
      userScope = { $or: [{ partnerId: partnerOid }, { stationId: { $in: sids } }] };
      stationScope = { partner: partnerOid };
      txScope = { station: { $in: sids } };
      stScope = { station: { $in: sids } };
    } else if (agent?.scopeType === "country" && agent?.countryId) {
      userScope = { countryId: agent.countryId };
      stationScope = { country: agent.countryId };
      txScope = { country: agent.countryId };
      stScope = { country: agent.countryId };
    }

    // 1. Search Users
    const userConditions: any[] = [{ fullName: regex }, { email: regex }, { phone: regex }];
    if (isObjectId) {
      userConditions.push({ _id: new Types.ObjectId(trimmed) });
    }
    const userQuery: any = Object.keys(userScope).length > 0
      ? { $and: [{ $or: userConditions }, userScope] }
      : { $or: userConditions };

    // 2. Search Credit Transactions
    const txConditions: any[] = [{ paymentReference: regex }, { paymentProvider: regex }];
    if (isObjectId) {
      txConditions.push({ _id: new Types.ObjectId(trimmed) });
      txConditions.push({ user: new Types.ObjectId(trimmed) });
    }
    const txQuery: any = Object.keys(txScope).length > 0
      ? { $and: [{ $or: txConditions }, txScope] }
      : { $or: txConditions };

    // 3. Search Listener Statements
    const stConditions: any[] = [{ ticket: regex }, { msisdn: regex }];
    if (isObjectId) {
      stConditions.push({ _id: new Types.ObjectId(trimmed) });
      stConditions.push({ user: new Types.ObjectId(trimmed) });
    }
    const stQuery: any = Object.keys(stScope).length > 0
      ? { $and: [{ $or: stConditions }, stScope] }
      : { $or: stConditions };

    // 4. Search Stations
    const stationConditions: any[] = [{ name: regex }, { stationCode: regex }];
    if (isObjectId) {
      stationConditions.push({ _id: new Types.ObjectId(trimmed) });
    }
    const stationQuery: any = Object.keys(stationScope).length > 0
      ? { $and: [{ $or: stationConditions }, stationScope] }
      : { $or: stationConditions };

    const [users, transactions, statements, stations] = await Promise.all([
      User.find(userQuery)
        .select("fullName email phone avatar role isBlocked countryId countryName stationId createdAt")
        .populate("countryId", "name code flag timezone")
        .limit(10)
        .lean(),
      CreditTransaction.find(txQuery)
        .populate("user", "fullName email phone avatar countryId countryName createdAt")
        .populate("country", "name code flag timezone")
        .limit(10)
        .lean(),
      ListenerStatement.find(stQuery)
        .populate({
          path: "user",
          select: "fullName email phone avatar countryId countryName createdAt",
          populate: { path: "countryId", select: "name code flag timezone" },
        })
        .populate("country", "name code flag timezone")
        .populate("station", "name code type")
        .limit(10)
        .lean(),
      Station.find(stationQuery)
        .select("name stationCode category logo isLive isActive country createdAt")
        .populate("country", "name code flag timezone")
        .limit(10)
        .lean(),
    ]);

    return {
      users: users.map((u: any) => ({ ...u, entityType: "user" })),
      transactions: transactions.map((t: any) => ({ ...t, entityType: "transaction" })),
      statements: statements.map((s: any) => ({ ...s, entityType: "statement" })),
      stations: stations.map((st: any) => ({ ...st, entityType: "station" })),
    };
  },

  getSupportStats: async (agent: TUser) => {
    const agentId = agent._id;

    // 1. Total resolved tickets by this agent
    const totalResolved = await SupportConversation.countDocuments({
      assignedAgentId: agentId,
      status: "CLOSED",
    });

    // 2. Currently active tickets assigned to this agent
    const activeAssigned = await SupportConversation.countDocuments({
      assignedAgentId: agentId,
      status: "ASSIGNED",
    });

    // 3. Open unassigned tickets in queue
    let openFilter: any = { status: "OPEN" };
    if (agent.scopeType === "country" && agent.countryId) {
      openFilter.countryId = agent.countryId;
    }
    const openUnassigned = await SupportConversation.countDocuments(openFilter);

    // 4. Unique listeners served by this agent
    const distinctUsers = await SupportConversation.distinct("userId", {
      assignedAgentId: agentId,
    });
    const uniqueListenersServed = distinctUsers.length;

    return {
      totalResolved,
      activeAssigned,
      openUnassigned,
      uniqueListenersServed,
    };
  },
};
