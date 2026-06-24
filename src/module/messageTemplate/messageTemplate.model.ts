
import mongoose, { Schema, Model } from "mongoose";

/**
 * IMessageTemplate interface.
 */
export interface IMessageTemplate  {
  _id?: mongoose.Types.ObjectId;
  id?: string;

  /** The station this template belongs to */
  station: mongoose.Types.ObjectId;

  /** The template text content */
  text: string;

  /** The user (admin) who created this template */
  createdBy: mongoose.Types.ObjectId;

  /** Whether this template is currently available for use */
  isActive: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

const messageTemplateSchema = new Schema<IMessageTemplate>(
  {
    station: {
      type: Schema.Types.ObjectId,
      ref: "Station",
      required: [true, "Station is required"],
      index: true,
    },
    text: {
      type: String,
      required: [true, "Template text is required"],
      maxlength: [1600, "Template text cannot exceed 1600 characters"],
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "createdBy is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index: station + isActive for quick filtered lookups
messageTemplateSchema.index({ station: 1, isActive: 1 });

const MessageTemplate: Model<IMessageTemplate> =
  mongoose.models.MessageTemplate ||
  mongoose.model<IMessageTemplate>("MessageTemplate", messageTemplateSchema);

export default MessageTemplate;
