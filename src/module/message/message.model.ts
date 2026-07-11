import mongoose, { Schema, Document } from "mongoose";
import { TMessage } from "./message.interface";

/**
 * IMessage extends both TMessage (our domain type) and Mongoose Document.
 * This gives us type-safe model operations while keeping TMessage as the
 * single source of truth for the Message schema shape.
 */
export interface IMessage extends TMessage, Document {}

const messageSchema = new Schema<IMessage>(
  {
    station: {
      type: Schema.Types.ObjectId,
      ref: "Station",
      required: [true, "Station is required"],
      index: true,
    },
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
    },
    senderType: {
      type: String,
      enum: ["user", "station"],
      required: [true, "senderType is required"],
      index: true,
    },
    senderUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    templateUsed: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
    },
    msisdn: {
      type: String,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    country: {
      type: Schema.Types.ObjectId,
      ref: "Country",
    },
    operator: {
      type: String,
      trim: true,
    },
    content: {
      type: String,
      required: [true, "Message content is required"],
      maxlength: [1600, "Message content cannot exceed 1600 characters"],
      trim: true,
      default: "",
    },
    imageUrl: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "sent_to_output", "rejected", "delivered"],
      default: "pending",
      index: true,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      maxlength: [500, "Rejection reason cannot exceed 500 characters"],
    },
    sentToOutputAt: {
      type: Date,
    },
    creditsUsed: {
      type: Number,
      min: [0, "Credits used cannot be negative"],
    },
    creditTransaction: {
      type: Schema.Types.ObjectId,
      ref: "CreditTransaction",
    },
    isReplied: {
      type: Boolean,
      default: false,
      index: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for common query patterns
messageSchema.index({ station: 1, status: 1, createdAt: -1 });
messageSchema.index({ station: 1, msisdn: 1, createdAt: 1 });
messageSchema.index({ station: 1, show: 1, createdAt: -1 });
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ user: 1, createdAt: -1 });

const Message = mongoose.model<IMessage>("Message", messageSchema);

export default Message;
