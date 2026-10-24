import { Types } from "mongoose";

export type PaymentProvider = "payleo" | "airtel";
export type PaymentCarrier = "MTN" | "AIRTEL";
export type PaymentStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface TPaymentTransaction {
  _id: Types.ObjectId;
  user: Types.ObjectId;                  // -> User
  provider: PaymentProvider;            // "payleo" | "airtel"
  carrier: PaymentCarrier;              // "MTN" | "AIRTEL"
  phoneNumber: string;                  // Normalized E.164 (+256...)
  amount: number;                       // Fiat amount in UGX (e.g. 2000)
  currency: string;                     // "UGX"
  creditsToGrant: number;               // Credits to credit upon success (e.g. 20)
  packageId?: string;                   // Server-side credit package that set amount/credits
  transactionId: string;                // Internal / Provider Transaction ID (unique index)
  referenceId?: string;                 // Gateway Reference ID
  providerReference?: string;           // Operator Reference (e.g. airtel_money_id / PayLeo ref)
  narration?: string;                   // Description / reason
  status: PaymentStatus;
  rawRequest?: any;                     // Audit payload sent to gateway
  rawCallback?: any;                    // Raw webhook payload received
  failureReason?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface InitiatePaymentDTO {
  packageId: string;      // Server-side package id; amount & credits come from the package
  phoneNumber: string;    // Raw input from user (e.g. "0771819679")
}

export interface PayLeoCallbackParsed {
  method: string;             // "receivePayment" | "notifyFailedPayment"
  msisdn: string;
  transactionId: string;
  referenceId?: string;
  amount: string;
  client_transaction?: string;
  narration?: string;
  message?: string;
}

// JSON body sent by the client's payleo_callback.php forwarder
export interface PayLeoForwardedCallback {
  status: "SUCCESS" | "FAILED";
  method: string;
  msisdn: string;
  transactionId: string;
  referenceId?: string | null;
  amount: string;
  client_transaction?: string | null;
  narration?: string | null;
  message?: string | null;
}

export interface AirtelCallbackParsed {
  transaction: {
    id: string;
    status_code: string;       // "TS" (Success), "TF" (Failed)
    airtel_money_id?: string;
    message?: string;
    amount?: number | string;
  };
  reference?: string;
}
