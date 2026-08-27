import { model, Schema } from "mongoose";
import { TStatusLike } from "./status-like.interface";

const statusLikeSchema = new Schema<TStatusLike>(
  {
    status: { type: Schema.Types.ObjectId, ref: "Status", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

statusLikeSchema.index({ status: 1, user: 1 }, { unique: true });
statusLikeSchema.index({ status: 1, createdAt: -1 });

export const StatusLike = model<TStatusLike>("StatusLike", statusLikeSchema);
