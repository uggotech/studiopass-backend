import { Types } from "mongoose";

export type MessageSenderType = "user" | "station";
export type MessageStatus = "pending" | "approved" | "sent_to_output" | "rejected" | "delivered";

export interface TMessage {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station (required)
  show?: Types.ObjectId; // → Show (auto-detected if not provided)
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
  videoUrl?: string; // MinIO path for video messages
  audioUrl?: string; // MinIO path for voice notes
  stickerUrl?: string; // MinIO path for sticker images
  audioDuration?: number; // Duration in seconds
  waveform?: number[]; // Normalized audio amplitude bars
  mediaType?: "text" | "image" | "video" | "audio" | "sticker";

  // TV approval (only for user messages on TV stations)
  status: MessageStatus;
  approvedBy?: Types.ObjectId; // → User
  approvedAt?: Date;
  rejectionReason?: string;
  sentToOutputAt?: Date;

  // Cost tracking (only for user messages)
  creditsUsed?: number;
  creditTransaction?: Types.ObjectId; // → CreditTransaction

  // Flags (only for user messages)
  isReplied: boolean; // default: false — fast stats query
  isRead: boolean; // default: false — read receipt tracking
  readAt?: Date; // when the message was read
  isDeleted: boolean; // default: false — staff/admin soft delete

  // Edit & user-level delete (WhatsApp-style)
  isEdited: boolean; // default: false
  editedAt?: Date;
  deletedFor?: Types.ObjectId[]; // user ids who deleted for themselves only
  deletedForEveryone: boolean; // default: false — tombstone for all viewers

  createdAt: Date;
  updatedAt: Date;
}
