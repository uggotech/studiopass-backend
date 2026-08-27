import { Types } from "mongoose";

export interface TStatusLike {
  _id: Types.ObjectId;
  status: Types.ObjectId; // → Status
  user: Types.ObjectId;   // → User
  createdAt: Date;
}

export type TPartialStatusLike = Partial<TStatusLike>;
