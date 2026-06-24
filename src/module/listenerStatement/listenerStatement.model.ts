import mongoose, { Schema, Model } from "mongoose";
import { TListenerStatement } from "./listenerStatement.interface";

const listenerStatementSchema = new Schema<TListenerStatement>(
  {
    statementId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["Call", "Message"],
      required: true,
    },
    sourceModel: {
      type: String,
      enum: ["Message", "Call"],
      required: true,
    },
    sourceId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    msisdn: {
      type: String,
      required: true,
      trim: true,
    },
    station: {
      type: Schema.Types.ObjectId,
      ref: "Station",
      required: true,
    },
    stationRef: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    mediaStation: {
      type: String,
      required: true,
      trim: true,
    },
    show: {
      type: Schema.Types.ObjectId,
      ref: "Show",
    },
    showName: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      required: true,
      trim: true,
    },
    currencySymbol: {
      type: String,
      required: true,
      trim: true,
    },
    creditsUsed: {
      type: Number,
      required: true,
      min: 0,
    },
    country: {
      type: Schema.Types.ObjectId,
      ref: "Country",
      required: true,
    },
    operator: {
      type: String,
      trim: true,
    },
    ticket: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Successful", "Failed", "Pending"],
      default: "Successful",
    },
  },
  { timestamps: true },
);

listenerStatementSchema.index({ user: 1, createdAt: -1 });
listenerStatementSchema.index({ user: 1, type: 1, createdAt: -1 });
listenerStatementSchema.index({ station: 1, createdAt: -1 });
listenerStatementSchema.index({ status: 1, createdAt: -1 });

const ListenerStatement: Model<TListenerStatement> =
  mongoose.models.ListenerStatement ||
  mongoose.model<TListenerStatement>("ListenerStatement", listenerStatementSchema);

export default ListenerStatement;
