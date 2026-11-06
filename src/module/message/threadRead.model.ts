import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * When a listener last opened the chat with a station. The chat list counts the station's replies newer than
 * this as "unread". One row per (listener, station); only the server's own clock is used.
 */
export interface IThreadRead extends Document {
  user: Types.ObjectId;
  station: Types.ObjectId;
  lastReadAt: Date;
}

const threadReadSchema = new Schema<IThreadRead>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    station: { type: Schema.Types.ObjectId, ref: "Station", required: true },
    lastReadAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

threadReadSchema.index({ user: 1, station: 1 }, { unique: true });

export const ThreadRead = mongoose.model<IThreadRead>("ThreadRead", threadReadSchema);
