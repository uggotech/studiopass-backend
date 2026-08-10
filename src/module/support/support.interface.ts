import { Types } from "mongoose";

export type TicketStatus = "OPEN" | "ASSIGNED" | "CLOSED";
export type SenderRole = "user" | "customer_care" | "super_admin";

export interface ISupportConversation {
  _id: Types.ObjectId;
  ticketId: string; // e.g. TKT-2026-0810-1234
  userId: Types.ObjectId; // Listener / User
  countryId?: Types.ObjectId; // Country of the user
  assignedAgentId?: Types.ObjectId; // Customer Care agent
  status: TicketStatus;
  lastMessage?: string;
  lastMessageAt?: Date;
  unreadCountUser: number;
  unreadCountAgent: number;
  closedAt?: Date;
  closedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISupportMessage {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  senderId: Types.ObjectId;
  senderRole: SenderRole;
  senderName?: string;
  message: string;
  attachments?: string[];
  createdAt: Date;
  updatedAt: Date;
}
