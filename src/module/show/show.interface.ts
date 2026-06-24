import { Types } from "mongoose";

export type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface TShow {
  _id: Types.ObjectId;
  station: Types.ObjectId; // → Station
  name: string; // "Morning Drive"
  description?: string;
  days: DayOfWeek[]; // ["monday", "tuesday", "wednesday", "thursday", "friday"]
  startTime: string; // "06:00" (HH:mm)
  endTime: string; // "09:00" (HH:mm)
  presenter?: Types.ObjectId; // → User (presenter)
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

