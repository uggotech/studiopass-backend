import { Types } from "mongoose";

export type MessageSenderType = "user" | "station";
export type MessageStatus = "pending" | "approved" | "sent_to_output" | "rejected" | "delivered";

export interface TMessage {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station (required)
  show: Types.ObjectId; // → Show (required — message always linked to show time)
  senderType: MessageSenderType; // "user" (listener) or "station" (media station/presenter reply)

  // Station reply fields (only when senderType = "station")
  senderUser?: Types.ObjectId; // → User (media station / presenter who sent this)
  templateUsed?: Types.ObjectId; // → MessageTemplate (if station used a template)

  // User message fields (only when senderType = "user")
  user?: Types.ObjectId; // → User (the listener who sent this message)
  msisdn?: string; // listener phone (required for user messages)
  country?: Types.ObjectId; // → Country
  operator?: string; // "Safaricom", "MTN", etc.

  // Content
  content: string;
  imageUrl?: string; // MinIO path for image messages

  // TV approval (only for user messages on TV stations)
  status: MessageStatus;
  approvedBy?: Types.ObjectId; // → User
  approvedAt?: Date;
  rejectionReason?: string;

  // Cost tracking (only for user messages)
  creditsUsed?: number;
  creditTransaction?: Types.ObjectId; // → CreditTransaction

  // Stats flag (only for user messages)
  isReplied: boolean; // default: false — fast stats query

  createdAt: Date;
  updatedAt: Date;
}
