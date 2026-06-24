import { Types } from "mongoose";

export interface TPartner {
  _id: Types.ObjectId;
  name: string; // "Capital FM Group"
  country: Types.ObjectId; // → Country
  contactEmail?: string;
  contactPhone?: string;
  logo?: string; // MinIO path
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}
