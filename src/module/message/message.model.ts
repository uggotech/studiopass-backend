/**
 * message.model.ts
 *
 * Mongoose model and interface for the Message entity.
 *
 * This is the core data structure for all communications in the system:
 * - User messages (listeners sending in during a show)
 * - Station replies (presenters responding to listeners)
 *
 * Design decisions:
 * - Single collection for both user and station messages (conversation model)
 * - senderType discriminator distinguishes who sent the message
 * - Status field drives the moderation workflow (TV) or immediate delivery (radio)
 * - isReplied tracks whether a station has responded to a listener's message
 */

import mongoose, { Schema, Document, Model } from "mongoose";

/**
 * IMessage interface represents a single message in the system.
 * Extends Mongoose Document for type-safe model operations.
 */
export interface IMessage extends Document {
  _id: mongoose.Types.ObjectId;
  id?: string;

  /** The station this message belongs to */
  station: mongoose.Types.ObjectId;

  /** The show during which this message was sent (auto-detected if not provided) */
  show?: mongoose.Types.ObjectId;

  /** "user" = listener message, "station" = presenter reply */
  senderType: "user" | "station";

  /** The user (presenter) who sent a station reply (required when senderType = "station") */
  senderUser?: mongoose.Types.ObjectId;

  /** If station used a template to compose the reply */
  templateUsed?: mongoose.Types.ObjectId;

  /** The listener who sent this message */
  user?: mongoose.Types.ObjectId;

  /** Listener's phone number (required for user messages, used for conversation threading) */
  msisdn?: string;

  /** Country code for the listener's phone number */
  country?: mongoose.Types.ObjectId;

  /** Mobile operator identifier (for billing/carrier-specific features) */
  operator?: string;

  /** The actual message content (text only, max 1600 chars) */
  content: string;

  /** MinIO path for image messages (optional) */
  imageUrl?: string;

  /** Current status in the moderation/delivery pipeline */
  status: "pending" | "approved" | "sent_to_output" | "rejected" | "delivered";

  /** Who approved the message (for TV moderation) */
  approvedBy?: mongoose.Types.ObjectId;

  /** When the message was approved */
  approvedAt?: Date;

  /** Reason for rejection (required when status = "rejected") */
  rejectionReason?: string;

  /** Number of credits consumed by this message (for billing) */
  creditsUsed?: number;

  /** Link to the credit transaction record */
  creditTransaction?: mongoose.Types.ObjectId;

  /** Whether a station has replied to this user message */
  isReplied: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

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
      // Not required: auto-detected if not provided
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
      // Required when senderType = "station" — enforced at service layer
    },
    templateUsed: {
      type: Schema.Types.ObjectId,
      ref: "MessageTemplate",
      // Optional: only set if station used a template
    },
    msisdn: {
      type: String,
      // Required when senderType = "user" — enforced at service layer
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
      // Optional: only set if message includes an image
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
  },
  {
    timestamps: true,
    // Prevent excessive index creation on large collections
    // Compound indexes added based on query patterns
  }
);

// Compound indexes for common query patterns
messageSchema.index({ station: 1, status: 1, createdAt: -1 }); // Moderation queue
messageSchema.index({ station: 1, msisdn: 1, createdAt: 1 }); // Conversation thread
messageSchema.index({ station: 1, show: 1, createdAt: -1 }); // Show-specific messages
messageSchema.index({ status: 1, createdAt: -1 }); // Global pending queue
messageSchema.index({ user: 1, createdAt: -1 }); // User's message history

const Message: Model<IMessage> =
  mongoose.models.Message || mongoose.model<IMessage>("Message", messageSchema);

export default Message;
