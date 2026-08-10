import { model, Schema } from "mongoose";
import { TShow } from "./show.interface";

const showSchema = new Schema<TShow>(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    days: {
      type: [String],
      enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      required: true,
    },
    startTime: { type: String, required: true }, // "06:00"
    endTime: { type: String, required: true }, // "09:00"
    presenter: { type: Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

showSchema.index({ station: 1, isActive: 1 });
showSchema.index({ presenter: 1 });

// Prevent exact time-slot duplicates on same station (race condition defense)
showSchema.index(
  { station: 1, startTime: 1, endTime: 1, name: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

// Show name must be unique per station (active shows only)
showSchema.index(
  { station: 1, name: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

export const Show = model<TShow>("Show", showSchema);
