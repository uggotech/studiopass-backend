import mongoose, { Schema, Model } from "mongoose";
import { ISupportConversation, ISupportMessage } from "./support.interface";

const supportConversationSchema = new Schema<ISupportConversation>(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    countryId: {
      type: Schema.Types.ObjectId,
      ref: "Country",
    },
    assignedAgentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    status: {
      type: String,
      enum: ["OPEN", "ASSIGNED", "CLOSED"],
      default: "OPEN",
    },
    lastMessage: {
      type: String,
      trim: true,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    unreadCountUser: {
      type: Number,
      default: 0,
    },
    unreadCountAgent: {
      type: Number,
      default: 0,
    },
    closedAt: {
      type: Date,
    },
    closedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

supportConversationSchema.index({ userId: 1, status: 1 });
supportConversationSchema.index({ countryId: 1, status: 1 });
supportConversationSchema.index({ assignedAgentId: 1, status: 1 });
supportConversationSchema.index({ ticketId: 1 });

const supportMessageSchema = new Schema<ISupportMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "SupportConversation",
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "customer_care", "super_admin"],
      required: true,
    },
    senderName: {
      type: String,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: [
      {
        type: String,
      },
    ],
  },
  { timestamps: true },
);

supportMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const SupportConversation: Model<ISupportConversation> =
  mongoose.models.SupportConversation ||
  mongoose.model<ISupportConversation>("SupportConversation", supportConversationSchema);

export const SupportMessage: Model<ISupportMessage> =
  mongoose.models.SupportMessage ||
  mongoose.model<ISupportMessage>("SupportMessage", supportMessageSchema);
