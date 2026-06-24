import { Types } from "mongoose";

export interface TMessageTemplate {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station
  text: string; // "Thank you for your message!"
  createdBy: Types.ObjectId; // → User (station admin)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

