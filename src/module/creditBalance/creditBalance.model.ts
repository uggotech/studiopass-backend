import { model, Schema } from "mongoose";
import { TCreditBalance } from "./creditBalance.interface";

const creditBalanceSchema = new Schema<TCreditBalance>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    balance: { type: Number, required: true, default: 0, min: 0 },
    paidBalance: { type: Number, default: 0, min: 0 },
    freeBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const CreditBalance = model<TCreditBalance>("CreditBalance", creditBalanceSchema);
