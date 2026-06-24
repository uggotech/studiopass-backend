import { Types } from "mongoose";

// ─── Status View Interface ───────────────────────────────────────────────────

export interface TStatusView {
  _id: Types.ObjectId;
  status: Types.ObjectId; // → Status
  user: Types.ObjectId; // → User
  viewedAt: Date;
}

export type TPartialStatusView = Partial<TStatusView>;
