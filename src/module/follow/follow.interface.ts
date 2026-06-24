import { Types } from "mongoose";

export interface TFollow {
  _id: Types.ObjectId;
  user: Types.ObjectId; // → User (the listener)
  station: Types.ObjectId; // → Station
  notificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TFollowStatus = {
  following: boolean;
  notificationsEnabled: boolean;
};