import { Types } from "mongoose";

export interface TCreditBalance {
  _id: Types.ObjectId;
  user: Types.ObjectId; // → User (unique)
  balance: number; // current available credits
  updatedAt: Date;
}

