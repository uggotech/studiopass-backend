import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { logger } from "../../logger/logger";
import { User } from "../user/user.model";
import { Country } from "../country/country.model";
import { CreditRepository } from "../credit/credit.repository";
import { normalizeUgandaPhone } from "../../shared/telecom/ugandaPhone.util";
import { PaymentTransaction } from "./payment.model";
import {
  InitiatePaymentDTO,
  AirtelCallbackParsed,
} from "./payment.interface";
import {
  generatePayLeoTransactionId,
  initiatePayLeoDeposit,
  parsePayLeoXmlCallback,
  buildPayLeoXmlResponse,
} from "./payleo.service";
import {
  generateAirtelId,
  initiateAirtelCollection,
} from "./airtel.service";

async function invalidateCreditBalanceCache(userId: string) {
  try {
    const { default: redisClient } = await import("../../redis/redisClient");
    await redisClient.del(`credit:balance:${userId}`);
  } catch {}
}

/**
 * Initiates mobile money collection (C2B push) for purchasing credits.
 * Routes automatically:
 * - MTN Uganda -> PayLeo API
 * - Airtel Uganda -> Airtel OpenAPI
 */
const initiatePayment = async (userId: string, data: InitiatePaymentDTO) => {
  logger.info(`[Payment Flow - Initiate] Processing payment initiation request:
  • User ID: ${userId}
  • Amount: ${data.amount}
  • Credits: ${data.credits}
  • Phone Input: "${data.phoneNumber}"
  • Narration: "${data.narration || "default"}"`);

  const user = await User.findById(userId).lean();
  if (!user) {
    logger.warn(`[Payment Flow - Initiate] User ${userId} not found in database`);
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const { amount, credits, phoneNumber, narration } = data;
  if (!amount || amount <= 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Amount must be greater than zero");
  }
  if (!credits || credits <= 0) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Credits must be greater than zero");
  }

  const phoneInfo = normalizeUgandaPhone(phoneNumber);
  logger.info(`[Payment Flow - Normalize] Phone normalization result:
  • Raw Input: "${phoneNumber}"
  • Is Valid: ${phoneInfo.isValid}
  • Carrier: ${phoneInfo.carrier}
  • E.164 Format: ${phoneInfo.e164}
  • PayLeo Format (256...): ${phoneInfo.payleoMsisdn}
  • Airtel Format (7...): ${phoneInfo.airtelMsisdn}`);

  if (!phoneInfo.isValid) {
    logger.warn(`[Payment Flow - Normalize] Invalid phone rejected: "${phoneNumber}". Reason: ${phoneInfo.error}`);
    throw new AppError(StatusCodes.BAD_REQUEST, phoneInfo.error || "Invalid Uganda phone number");
  }

  if (phoneInfo.carrier !== "MTN" && phoneInfo.carrier !== "AIRTEL") {
    logger.warn(`[Payment Flow - Routing] Unsupported carrier rejected: "${phoneInfo.carrier}"`);
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      `Unsupported carrier: ${phoneInfo.carrier}. Mobile money top-up is only available for MTN and Airtel numbers.`,
    );
  }

  const defaultNarration = narration || `StudioPass ${credits} Credits`;

  // ─── 1. MTN Uganda -> PayLeo ─────────────────────────────────────────────
  if (phoneInfo.carrier === "MTN") {
    const transactionId = generatePayLeoTransactionId();
    logger.info(`[Payment Flow - MTN/PayLeo] Routing to PayLeo aggregator. Generated transactionId: ${transactionId}`);

    const payment = await PaymentTransaction.create({
      user: user._id,
      provider: "payleo",
      carrier: "MTN",
      phoneNumber: phoneInfo.e164,
      amount,
      currency: "UGX",
      creditsToGrant: credits,
      transactionId,
      narration: defaultNarration,
      status: "pending",
      rawRequest: {
        msisdn: phoneInfo.payleoMsisdn,
        amount,
        transactionId,
        narration: defaultNarration,
      },
    });
    logger.info(`[Payment Flow - MTN/PayLeo] Stored pending PaymentTransaction record: id=${payment._id}, txId=${transactionId}`);

    const pushResult = await initiatePayLeoDeposit({
      msisdn: phoneInfo.payleoMsisdn,
      amount,
      transactionId,
      narration: defaultNarration,
    });

    if (!pushResult.success) {
      logger.warn(`[Payment Flow - MTN/PayLeo] Push failed for txId ${transactionId}. Updating record to "failed".`);
      await PaymentTransaction.findByIdAndUpdate(payment._id, {
        status: "failed",
        failureReason: pushResult.error || "Gateway rejected deposit request",
        rawCallback: pushResult.data,
      });

      throw new AppError(
        StatusCodes.BAD_GATEWAY,
        pushResult.error || "Failed to trigger MTN Mobile Money prompt",
      );
    }

    logger.info(`[Payment Flow - MTN/PayLeo] C2B Push initiated successfully. Awaiting customer USSD/PIN on handset.`);
    return {
      status: "pending",
      provider: "payleo",
      carrier: "MTN",
      transactionId,
      amount,
      currency: "UGX",
      credits,
      message: "Payment initiated. Please check your phone and enter your MTN Mobile Money PIN to complete.",
    };
  }

  // ─── 2. Airtel Uganda -> Airtel OpenAPI ───────────────────────────────────
  const reference = generateAirtelId("COL");
  const transactionId = generateAirtelId("TXN");
  logger.info(`[Payment Flow - Airtel] Routing to Airtel OpenAPI. Ref: ${reference}, txId: ${transactionId}`);

  const payment = await PaymentTransaction.create({
    user: user._id,
    provider: "airtel",
    carrier: "AIRTEL",
    phoneNumber: phoneInfo.e164,
    amount,
    currency: "UGX",
    creditsToGrant: credits,
    transactionId,
    referenceId: reference,
    narration: defaultNarration,
    status: "pending",
    rawRequest: {
      msisdn: phoneInfo.airtelMsisdn,
      amount,
      transactionId,
      reference,
      narration: defaultNarration,
    },
  });
  logger.info(`[Payment Flow - Airtel] Stored pending PaymentTransaction record: id=${payment._id}, txId=${transactionId}`);

  const collectionResult = await initiateAirtelCollection({
    msisdn: phoneInfo.airtelMsisdn,
    amount,
    transactionId,
    reference,
    narration: defaultNarration,
  });

  if (!collectionResult.success) {
    logger.warn(`[Payment Flow - Airtel] Collection failed for txId ${transactionId}. Updating record to "failed".`);
    await PaymentTransaction.findByIdAndUpdate(payment._id, {
      status: "failed",
      failureReason: collectionResult.error || "Gateway rejected payment request",
      rawCallback: collectionResult.data,
    });

    throw new AppError(
      StatusCodes.BAD_GATEWAY,
      collectionResult.error || "Failed to trigger Airtel Money prompt",
    );
  }

  logger.info(`[Payment Flow - Airtel] Collection initiated successfully. Awaiting customer PIN on handset.`);
  return {
    status: "pending",
    provider: "airtel",
    carrier: "AIRTEL",
    transactionId,
    referenceId: reference,
    amount,
    currency: "UGX",
    credits,
    message: "Payment initiated. Please check your phone and enter your Airtel Money PIN to complete.",
  };
};

/**
 * Handles incoming raw XML webhook callback from PayLeo (True African).
 * Idempotently updates payment status and grants user credits on success.
 */
const handlePayLeoWebhook = async (rawXml: string): Promise<string> => {
  const parsed = parsePayLeoXmlCallback(rawXml);
  if (!parsed) {
    logger.warn("[PayLeo Webhook] Received unparseable XML payload from True African");
    return buildPayLeoXmlResponse(400, "Invalid XML");
  }

  const { method, transactionId, referenceId, message } = parsed;
  logger.info(`[PayLeo Webhook] Callback received: method="${method}", txId="${transactionId}", ref="${referenceId || "none"}"`);

  const payment = await PaymentTransaction.findOne({ transactionId });
  if (!payment) {
    logger.warn(`[PayLeo Webhook] ⚠️ Transaction not found in database for txId: "${transactionId}". Returning 200 to acknowledge.`);
    return buildPayLeoXmlResponse(200, "Transaction received");
  }

  logger.info(`[PayLeo Webhook] Found PaymentTransaction:
  • ID: ${payment._id}
  • Current Status: ${payment.status}
  • User: ${payment.user}
  • Amount: ${payment.amount} ${payment.currency}
  • Credits to grant: ${payment.creditsToGrant}`);

  // Idempotency: skip if already completed
  if (payment.status === "completed") {
    logger.info(`[PayLeo Webhook] ℹ️ Transaction ${transactionId} is already marked "completed". Skipping duplicate credit allocation.`);
    return buildPayLeoXmlResponse(200, "Transaction received");
  }

  if (method === "receivePayment") {
    logger.info(`[PayLeo Webhook] Processing successful payment method: "receivePayment". Beginning credit grant...`);
    // 1. Mark payment as completed
    payment.status = "completed";
    payment.referenceId = referenceId || payment.referenceId;
    payment.completedAt = new Date();
    payment.rawCallback = parsed;
    await payment.save();
    logger.info(`[PayLeo Webhook] PaymentTransaction marked as "completed" in MongoDB.`);

    // 2. Atomic credit grant
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const prevDoc = await CreditRepository.getBalance(String(payment.user));
      const previousBalance = prevDoc?.balance ?? 0;

      const updated = await CreditRepository.incrementBalance(
        String(payment.user),
        payment.creditsToGrant,
        false, // Paid purchase
        session,
      );

      const newBalance = updated?.balance ?? (previousBalance + payment.creditsToGrant);
      logger.info(`[PayLeo Webhook] Balance updated for user ${payment.user}: ${previousBalance} -> ${newBalance} (+${payment.creditsToGrant} credits)`);

      const userDoc = await User.findById(payment.user).select("countryId").lean();
      const countryDoc = userDoc?.countryId
        ? await Country.findById(userDoc.countryId).select("code currency").lean()
        : null;

      await CreditRepository.createTransaction(
        {
          user: payment.user,
          type: "purchase",
          amount: payment.creditsToGrant,
          isFree: false,
          previousBalance,
          newBalance,
          paymentMethod: "mobile_money",
          paymentProvider: "payleo",
          paymentReference: payment.transactionId,
          currency: payment.currency || countryDoc?.currency || "UGX",
          localAmount: payment.amount,
          country: userDoc?.countryId || undefined,
          status: "completed",
        },
        session,
      );

      await session.commitTransaction();
      await invalidateCreditBalanceCache(String(payment.user));
      logger.info(`[PayLeo Webhook] ✅ Successfully credited ${payment.creditsToGrant} credits to user ${payment.user}. Redis balance cache invalidated.`);
    } catch (err) {
      await session.abortTransaction();
      logger.error(`[PayLeo Webhook] 💥 Error crediting balance for user ${payment.user}:`, err);
    } finally {
      session.endSession();
    }
  } else if (method === "notifyFailedPayment") {
    payment.status = "failed";
    payment.failureReason = message || "Payment rejected or timed out by user";
    payment.rawCallback = parsed;
    await payment.save();
    logger.info(`[PayLeo Webhook] ❌ Marked txId ${transactionId} as failed: ${payment.failureReason}`);
  } else {
    logger.warn(`[PayLeo Webhook] Unknown method received: "${method}". Leaving transaction unchanged.`);
  }

  return buildPayLeoXmlResponse(200, "Transaction received");
};

/**
 * Handles incoming JSON webhook callback from Airtel OpenAPI.
 * Idempotently updates payment status and grants user credits on success.
 */
const handleAirtelWebhook = async (payload: AirtelCallbackParsed) => {
  const tx = payload?.transaction;
  const transactionId = tx?.id;
  const statusCode = String(tx?.status_code || "").toUpperCase();
  const airtelMoneyId = tx?.airtel_money_id;
  const message = tx?.message;

  logger.info(`[Airtel Webhook] Inbound callback: txId="${transactionId}", status_code="${statusCode}", airtel_money_id="${airtelMoneyId}"`);

  if (!transactionId) {
    logger.warn("[Airtel Webhook] Missing transaction ID in callback payload");
    return { status: "ok" };
  }

  const payment = await PaymentTransaction.findOne({ transactionId });
  if (!payment) {
    logger.warn(`[Airtel Webhook] ⚠️ Transaction not found in database for txId: "${transactionId}"`);
    return { status: "ok" };
  }

  logger.info(`[Airtel Webhook] Found PaymentTransaction:
  • ID: ${payment._id}
  • Current Status: ${payment.status}
  • User: ${payment.user}
  • Amount: ${payment.amount} ${payment.currency}
  • Credits to grant: ${payment.creditsToGrant}`);

  // Idempotency: skip if already completed
  if (payment.status === "completed") {
    logger.info(`[Airtel Webhook] ℹ️ Transaction ${transactionId} is already marked "completed". Skipping duplicate credit allocation.`);
    return { status: "ok" };
  }

  if (statusCode === "TS" || statusCode === "SUCCESS") {
    logger.info(`[Airtel Webhook] Processing successful payment (status: ${statusCode}). Beginning credit grant...`);
    payment.status = "completed";
    payment.providerReference = airtelMoneyId || payment.providerReference;
    payment.completedAt = new Date();
    payment.rawCallback = payload;
    await payment.save();

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const prevDoc = await CreditRepository.getBalance(String(payment.user));
      const previousBalance = prevDoc?.balance ?? 0;

      const updated = await CreditRepository.incrementBalance(
        String(payment.user),
        payment.creditsToGrant,
        false, // Paid purchase
        session,
      );

      const newBalance = updated?.balance ?? (previousBalance + payment.creditsToGrant);
      logger.info(`[Airtel Webhook] Balance updated for user ${payment.user}: ${previousBalance} -> ${newBalance} (+${payment.creditsToGrant} credits)`);

      const userDoc = await User.findById(payment.user).select("countryId").lean();
      const countryDoc = userDoc?.countryId
        ? await Country.findById(userDoc.countryId).select("code currency").lean()
        : null;

      await CreditRepository.createTransaction(
        {
          user: payment.user,
          type: "purchase",
          amount: payment.creditsToGrant,
          isFree: false,
          previousBalance,
          newBalance,
          paymentMethod: "mobile_money",
          paymentProvider: "airtel",
          paymentReference: payment.transactionId,
          currency: payment.currency || countryDoc?.currency || "UGX",
          localAmount: payment.amount,
          country: userDoc?.countryId || undefined,
          status: "completed",
        },
        session,
      );

      await session.commitTransaction();
      await invalidateCreditBalanceCache(String(payment.user));
      logger.info(`[Airtel Webhook] ✅ Successfully credited ${payment.creditsToGrant} credits to user ${payment.user}. Redis balance cache invalidated.`);
    } catch (err) {
      await session.abortTransaction();
      logger.error(`[Airtel Webhook] 💥 Error crediting balance for user ${payment.user}:`, err);
    } finally {
      session.endSession();
    }
  } else if (statusCode === "TF" || statusCode === "FAILED" || statusCode === "ERROR") {
    payment.status = "failed";
    payment.failureReason = message || "Payment rejected or timed out by subscriber";
    payment.rawCallback = payload;
    await payment.save();
    logger.info(`[Airtel Webhook] ❌ Marked txId ${transactionId} as failed: ${payment.failureReason}`);
  } else {
    logger.warn(`[Airtel Webhook] Unrecognized status code: "${statusCode}"`);
  }

  return { status: "ok" };
};

export const PaymentService = {
  initiatePayment,
  handlePayLeoWebhook,
  handleAirtelWebhook,
};
