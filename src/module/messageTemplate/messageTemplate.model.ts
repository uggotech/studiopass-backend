import mongoose, { Schema, Model, Document } from "mongoose";
import { TMessageTemplate } from "./messageTemplate.interface";

/**
 * IMessageTemplate extends both TMessageTemplate and Mongoose Document.
 */
export interface IMessageTemplate extends TMessageTemplate, Document {}

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

messageTemplateSchema.index({ station: 1, isActive: 1 });

const MessageTemplate: Model<IMessageTemplate> =
  mongoose.models.MessageTemplate ||
  mongoose.model<IMessageTemplate>("MessageTemplate", messageTemplateSchema);

export default MessageTemplate;
