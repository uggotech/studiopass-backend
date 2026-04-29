import { Types } from "mongoose";

export interface TFollow {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  broadcast: Types.ObjectId;
  notificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type TFollowStatus = {
  following: boolean;
  notificationsEnabled: boolean;
};