import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import config from "../../config";
import { logger } from "../../logger/logger";
import { User } from "../user/user.model";
import { CreditRepository } from "../credit/credit.repository";
import { NotificationService } from "../notification/notification.service";
import { normalizeUgandaPhone } from "../../shared/telecom/ugandaPhone.util";
import { PaymentTransaction } from "./payment.model";
import {
  InitiatePaymentDTO,
  AirtelCallbackParsed,
  PayLeoCallbackParsed,
  PaymentProvider,
  TPaymentTransaction,
} from "./payment.interface";
import { getCreditPackages, findCreditPackage } from "./payment.packages";
import {
  generatePayLeoTransactionId,
  initiatePayLeoDeposit,
  isPayLeoConfigured,
  buildPayLeoXmlResponse,
} from "./payleo.service";
import {
  generateAirtelId,
  initiateAirtelCollection,
  isAirtelConfigured,
  getAirtelTransactionStatus,
} from "./airtel.service";

async function invalidateCreditBalanceCache(userId: string) {
  try {
    const { default: redisClient } = await import("../../redis/redisClient");
    await redisClient.del(`credit:balance:${userId}`);
  } catch {}
}

const getPackages = () => getCreditPackages();

/**
 * Initiates mobile money collection (C2B push) for purchasing a credit package.
 * Amount and credits come from the server-side package table, never from the client.
 * Routes automatically:
 * - MTN Uganda -> PayLeo API
 * - Airtel Uganda -> Airtel OpenAPI
 */
const initiatePayment = async (userId: string, data: InitiatePaymentDTO) => {
  const pkg = findCreditPackage(data.packageId);
  if (!pkg) {
    throw new AppError(StatusCodes.BAD_REQUEST, "Unknown credit package");
  }

  const user = await User.findById(userId).select("_id").lean();
  if (!user) {
    throw new AppError(StatusCodes.NOT_FOUND, "User not found");
  }

  const phoneInfo = normalizeUgandaPhone(data.phoneNumber);
  if (!phoneInfo.isValid) {
    throw new AppError(StatusCodes.BAD_REQUEST, phoneInfo.error || "Invalid Uganda phone number");
  }

  if (phoneInfo.carrier !== "MTN" && phoneInfo.carrier !== "AIRTEL") {
    throw new AppError(
      StatusCodes.BAD_REQUEST,
      "Mobile money top-up is only available for MTN and Airtel numbers.",
    );
  }

  const amount = pkg.amountUgx;
  const credits = pkg.credits;
  const narration = `StudioPass ${credits} Credits`;

  logger.info(`[Payment Flow - Initiate] user=${userId}, package=${pkg.id} (${amount} UGX -> ${credits} credits), carrier=${phoneInfo.carrier}`);

  // ─── 1. MTN Uganda -> PayLeo ─────────────────────────────────────────────
  if (phoneInfo.carrier === "MTN") {
    if (!isPayLeoConfigured()) {
      logger.error("[Payment Flow - MTN/PayLeo] PAYLEO_* credentials missing in environment");
      throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "MTN Mobile Money is temporarily unavailable");
    }

    const transactionId = generatePayLeoTransactionId();
    const payment = await PaymentTransaction.create({
      user: user._id,
      provider: "payleo",
      carrier: "MTN",
      phoneNumber: phoneInfo.e164,
      amount,
      currency: "UGX",
      creditsToGrant: credits,
      packageId: pkg.id,
      transactionId,
      narration,
      status: "pending",
      rawRequest: { msisdn: phoneInfo.payleoMsisdn, amount, transactionId, narration },
    });

    const pushResult = await initiatePayLeoDeposit({
      msisdn: phoneInfo.payleoMsisdn,
      amount,
      transactionId,
      narration,
    });

    if (!pushResult.success) {
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

    return {
      status: "pending",
      provider: "payleo",
      carrier: "MTN",
      transactionId,
      packageId: pkg.id,
      amount,
      currency: "UGX",
      credits,
      message: "Payment initiated. Please check your phone and enter your MTN Mobile Money PIN to complete.",
    };
  }

  // ─── 2. Airtel Uganda -> Airtel OpenAPI ───────────────────────────────────
  if (!isAirtelConfigured()) {
    logger.error("[Payment Flow - Airtel] AIRTEL_* credentials missing in environment");
    throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "Airtel Money is temporarily unavailable");
  }

  const reference = generateAirtelId("COL");
  const transactionId = generateAirtelId("TXN");

  const payment = await PaymentTransaction.create({
    user: user._id,
    provider: "airtel",
    carrier: "AIRTEL",
    phoneNumber: phoneInfo.e164,
    amount,
    currency: "UGX",
    creditsToGrant: credits,
    packageId: pkg.id,
    transactionId,
    referenceId: reference,
    narration,
    status: "pending",
    rawRequest: { msisdn: phoneInfo.airtelMsisdn, amount, transactionId, reference, narration },
  });

  const collectionResult = await initiateAirtelCollection({
    msisdn: phoneInfo.airtelMsisdn,
    amount,
    transactionId,
    reference,
    narration,
  });

  if (!collectionResult.success) {
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

  return {
    status: "pending",
    provider: "airtel",
    carrier: "AIRTEL",
    transactionId,
    referenceId: reference,
    packageId: pkg.id,
    amount,
    currency: "UGX",
    credits,
    message: "Payment initiated. Please check your phone and enter your Airtel Money PIN to complete.",
  };
};

type CompleteResult = "credited" | "duplicate" | "not_found";

/**
 * Marks a payment completed AND credits the user in ONE MongoDB transaction.
 * The status transition is a conditional update, so concurrent/duplicate callbacks
 * can credit at most once. On any error the transaction aborts (payment stays
 * pending/failed) and the error is re-thrown so the caller can ask the provider to retry.
 */
type CompletePaymentParams = {
  transactionId: string;
  provider: PaymentProvider;
  providerReference?: string;
  referenceId?: string;
  rawCallback?: unknown;
};

const completePaymentOnce = async (params: CompletePaymentParams): Promise<CompleteResult> => {
  const { transactionId, provider } = params;
  const session = await mongoose.startSession();
  let payment: TPaymentTransaction | null = null;

  try {
    session.startTransaction();

    const $set: Record<string, unknown> = {
      status: "completed",
      completedAt: new Date(),
      failureReason: null,
    };
    if (params.providerReference) $set.providerReference = params.providerReference;
    if (params.referenceId) $set.referenceId = params.referenceId;
    if (params.rawCallback !== undefined) $set.rawCallback = params.rawCallback;

    payment = await PaymentTransaction.findOneAndUpdate(
      { transactionId, provider, status: { $in: ["pending", "processing", "failed"] } },
      { $set },
      { session, returnDocument: "after" },
    ).lean();

    if (!payment) {
      await session.abortTransaction();
      const exists = await PaymentTransaction.exists({ transactionId, provider });
      return exists ? "duplicate" : "not_found";
    }

    const userId = String(payment.user);
    const updated = await CreditRepository.incrementBalance(userId, payment.creditsToGrant, false, session);
    if (!updated) {
      throw new Error(`Credit balance update returned nothing for user ${userId}`);
    }
    const newBalance = updated.balance;
    const previousBalance = newBalance - payment.creditsToGrant;

    const userDoc = await User.findById(userId).select("countryId").session(session).lean();

    await CreditRepository.createTransaction(
      {
        user: payment.user,
        type: "purchase",
        amount: payment.creditsToGrant,
        isFree: false,
        previousBalance,
        newBalance,
        paymentMethod: "mobile_money",
        paymentProvider: provider,
        paymentReference: payment.transactionId,
        currency: payment.currency || "UGX",
        localAmount: payment.amount,
        country: userDoc?.countryId || undefined,
        status: "completed",
      },
      session,
    );

    await session.commitTransaction();
    logger.info(`[Payment] ✅ txId=${transactionId} completed: +${payment.creditsToGrant} credits to user ${userId} (${previousBalance} -> ${newBalance})`);
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    throw err;
  } finally {
    await session.endSession();
  }

  const userId = String(payment.user);
  await invalidateCreditBalanceCache(userId);
  try {
    await NotificationService.createNotification({
      userId,
      type: "system",
      title: "Payment received",
      body: `${payment.creditsToGrant} credits have been added to your account.`,
      data: { kind: "payment", transactionId, route: "/profile/payment-history" },
    });
  } catch (err) {
    logger.warn(`[Payment] Notification failed for txId=${transactionId}:`, err);
  }
  return "credited";
};

const isTransientTxError = (err: any) =>
  Boolean(err?.hasErrorLabel?.("TransientTransactionError") || err?.code === 112 /* WriteConflict */);

/**
 * completePaymentOnce with retries for transient transaction errors (e.g. two callbacks
 * racing on the same payment). The losing callback retries, sees the payment already
 * completed and returns "duplicate", so it is acknowledged instead of erroring.
 */
const completePayment = async (params: CompletePaymentParams): Promise<CompleteResult> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await completePaymentOnce(params);
    } catch (err) {
      if (isTransientTxError(err) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
        continue;
      }
      logger.error(`[Payment] 💥 Failed to complete txId=${params.transactionId}; payment left unchanged:`, err);
      throw err;
    }
  }
};

/**
 * Marks a not-yet-completed payment as failed. Completed payments are never downgraded.
 */
const failPayment = async (
  transactionId: string,
  provider: PaymentProvider,
  reason: string,
  rawCallback?: unknown,
) => {
  const $set: Record<string, unknown> = { status: "failed", failureReason: reason };
  if (rawCallback !== undefined) $set.rawCallback = rawCallback;
  const res = await PaymentTransaction.updateOne(
    { transactionId, provider, status: { $in: ["pending", "processing"] } },
    { $set },
  );
  if (res.modifiedCount) logger.info(`[Payment] ❌ txId=${transactionId} marked failed: ${reason}`);
};

/**
 * Handles a PayLeo (True African) callback, already parsed from XML or from the
 * client's JSON forwarder. Returns the HTTP status + XML acknowledgment to send.
 * A non-200 is returned only when crediting failed, so PayLeo retries.
 */
const handlePayLeoCallback = async (
  parsed: PayLeoCallbackParsed | null,
): Promise<{ httpStatus: number; xml: string }> => {
  const ack = { httpStatus: 200, xml: buildPayLeoXmlResponse(200, "Transaction received") };

  if (!parsed) {
    return { httpStatus: 400, xml: buildPayLeoXmlResponse(400, "Invalid PayLeo XML") };
  }

  // PayLeo's documented callback echoes our id in <transactionId>; some samples
  // carry it in <client_transaction> instead. Match either.
  const candidates = [parsed.client_transaction, parsed.transactionId].filter(Boolean) as string[];
  const payment = await PaymentTransaction.findOne({
    provider: "payleo",
    transactionId: { $in: candidates },
  }).lean();

  if (!payment) {
    logger.warn(`[PayLeo Webhook] No PaymentTransaction for ids ${JSON.stringify(candidates)}; acknowledged without crediting`);
    return ack;
  }
  if (payment.status === "completed") {
    logger.info(`[PayLeo Webhook] txId=${payment.transactionId} already completed; duplicate acknowledged`);
    return ack;
  }

  if (parsed.method === "receivePayment") {
    const paidAmount = Number(parsed.amount);
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - payment.amount) > 0.01) {
      logger.error(`[PayLeo Webhook] ⚠️ Amount mismatch for txId=${payment.transactionId}: callback="${parsed.amount}", expected=${payment.amount}. Not crediting.`);
      await failPayment(payment.transactionId, "payleo", `Amount mismatch: received ${parsed.amount}, expected ${payment.amount}`, parsed);
      return ack;
    }

    try {
      await completePayment({
        transactionId: payment.transactionId,
        provider: "payleo",
        providerReference: parsed.referenceId && parsed.referenceId !== "NULL" ? parsed.referenceId : undefined,
        rawCallback: parsed,
      });
      return ack;
    } catch {
      return { httpStatus: 500, xml: buildPayLeoXmlResponse(500, "Temporary error, please retry") };
    }
  }

  if (parsed.method === "notifyFailedPayment") {
    await failPayment(payment.transactionId, "payleo", parsed.message || "Payment rejected or timed out by user", parsed);
    return ack;
  }

  logger.warn(`[PayLeo Webhook] Unknown method "${parsed.method}" for txId=${payment.transactionId}; left unchanged`);
  return ack;
};

/**
 * Asks Airtel for the real transaction status and applies it.
 * Used by the webhook (to verify a "TS" callback), the status endpoint and the reconciler.
 */
const reconcileAirtelPayment = async (transactionId: string): Promise<"credited" | "failed" | "pending"> => {
  const enquiry = await getAirtelTransactionStatus(transactionId);

  if (enquiry.state === "SUCCESS") {
    const result = await completePayment({
      transactionId,
      provider: "airtel",
      providerReference: enquiry.airtelMoneyId,
      rawCallback: enquiry.raw,
    });
    return result === "credited" || result === "duplicate" ? "credited" : "pending";
  }

  if (enquiry.state === "FAILED") {
    await failPayment(transactionId, "airtel", enquiry.message || `Airtel status ${enquiry.statusCode}`, enquiry.raw);
    return "failed";
  }

  return "pending";
};

/**
 * Handles incoming JSON webhook callback from Airtel OpenAPI.
 * A "TS" callback is never trusted on its own: the status is confirmed with
 * Airtel's transaction enquiry API before any credits are granted.
 */
const handleAirtelWebhook = async (payload: AirtelCallbackParsed, opts: { trusted?: boolean } = {}) => {
  const tx = payload?.transaction;
  const transactionId = tx?.id;
  const statusCode = String(tx?.status_code || "").toUpperCase();

  logger.info(`[Airtel Webhook] Callback: txId="${transactionId}", status_code="${statusCode}", airtel_money_id="${tx?.airtel_money_id}"`);

  if (!transactionId) return { status: "ok" };

  const payment = await PaymentTransaction.findOne({ transactionId, provider: "airtel" }).lean();
  if (!payment) {
    logger.warn(`[Airtel Webhook] No PaymentTransaction for txId="${transactionId}"`);
    return { status: "ok" };
  }
  if (payment.status === "completed") return { status: "ok" };

  if (statusCode === "TS" || statusCode === "SUCCESS") {
    // Throws on DB failure -> controller answers 500 so the payment stays pending for retry/reconciler
    if (opts.trusted) {
      // Callback hash verified with our Hash Key: cryptographic proof it came from Airtel
      await completePayment({
        transactionId,
        provider: "airtel",
        providerReference: tx?.airtel_money_id,
        rawCallback: payload,
      });
    } else {
      const outcome = await reconcileAirtelPayment(transactionId);
      if (outcome === "failed") {
        logger.error(`[Airtel Webhook] ⚠️ Callback claimed success for txId=${transactionId} but Airtel enquiry says failed. Possible forged callback.`);
      } else if (outcome === "pending") {
        logger.warn(`[Airtel Webhook] Enquiry for txId=${transactionId} not conclusive yet; reconciler will retry`);
      }
    }
  } else if (statusCode === "TF" || statusCode === "FAILED" || statusCode === "ERROR") {
    await failPayment(transactionId, "airtel", tx?.message || "Payment rejected or timed out by subscriber", payload);
  } else {
    logger.warn(`[Airtel Webhook] Unrecognized status code: "${statusCode}"`);
  }

  return { status: "ok" };
};

// Throttle on-demand Airtel enquiries triggered by app status polling (per transaction)
const lastEnquiryAt = new Map<string, number>();
const ON_DEMAND_ENQUIRY_MIN_AGE_MS = 20_000;
const ON_DEMAND_ENQUIRY_INTERVAL_MS = 10_000;

/**
 * Returns the status of one of the user's own payments (used by the app to poll).
 * For pending Airtel payments it also asks Airtel directly, so the app gets an
 * answer even when the callback is delayed or lost.
 */
const getPaymentStatus = async (userId: string, transactionId: string) => {
  let payment = await PaymentTransaction.findOne({ transactionId, user: userId }).lean();
  if (!payment) {
    throw new AppError(StatusCodes.NOT_FOUND, "Payment not found");
  }

  const age = Date.now() - new Date(payment.createdAt).getTime();
  const last = lastEnquiryAt.get(transactionId) || 0;
  if (
    payment.status === "pending" &&
    payment.provider === "airtel" &&
    age > ON_DEMAND_ENQUIRY_MIN_AGE_MS &&
    Date.now() - last > ON_DEMAND_ENQUIRY_INTERVAL_MS
  ) {
    lastEnquiryAt.set(transactionId, Date.now());
    try {
      await reconcileAirtelPayment(transactionId);
      payment = (await PaymentTransaction.findOne({ transactionId, user: userId }).lean()) || payment;
    } catch (err) {
      logger.warn(`[Payment] On-demand Airtel enquiry failed for txId=${transactionId}:`, err);
    }
  }
  if (payment.status !== "pending") lastEnquiryAt.delete(transactionId);

  return {
    transactionId: payment.transactionId,
    status: payment.status,
    provider: payment.provider,
    carrier: payment.carrier,
    packageId: payment.packageId,
    amount: payment.amount,
    currency: payment.currency,
    credits: payment.creditsToGrant,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt,
    completedAt: payment.completedAt,
  };
};

const AIRTEL_RECONCILE_MIN_AGE_MS = 3 * 60 * 1000;
const AIRTEL_EXPIRE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves stuck pending payments:
 * - Airtel pending > 3 min: ask Airtel (credit or fail); pending > 24h: expire.
 * - PayLeo pending > PAYLEO_PENDING_TIMEOUT_MINUTES: mark failed (a late success
 *   callback is still accepted because completePayment also accepts "failed").
 */
const reconcilePendingPayments = async () => {
  const now = Date.now();

  const airtelPending = await PaymentTransaction.find({
    provider: "airtel",
    status: "pending",
    createdAt: { $lte: new Date(now - AIRTEL_RECONCILE_MIN_AGE_MS) },
  })
    .sort({ createdAt: 1 })
    .limit(50)
    .select("transactionId createdAt")
    .lean();

  for (const p of airtelPending) {
    try {
      const outcome = await reconcileAirtelPayment(p.transactionId);
      if (outcome === "pending" && now - new Date(p.createdAt).getTime() > AIRTEL_EXPIRE_AGE_MS) {
        await failPayment(p.transactionId, "airtel", "Expired: no final status from Airtel within 24 hours");
      }
    } catch (err) {
      logger.error(`[Payment Reconciler] Airtel txId=${p.transactionId} failed:`, err);
    }
  }

  const payleoCutoff = new Date(now - config.payleo.pending_timeout_minutes * 60 * 1000);
  const res = await PaymentTransaction.updateMany(
    { provider: "payleo", status: "pending", createdAt: { $lte: payleoCutoff } },
    {
      $set: {
        status: "failed",
        failureReason: `No confirmation from PayLeo within ${config.payleo.pending_timeout_minutes} minutes`,
      },
    },
  );
  if (res.modifiedCount) {
    logger.warn(`[Payment Reconciler] Marked ${res.modifiedCount} PayLeo payment(s) failed after timeout`);
  }
};

export const PaymentService = {
  getPackages,
  initiatePayment,
  completePayment,
  handlePayLeoCallback,
  handleAirtelWebhook,
  getPaymentStatus,
  reconcilePendingPayments,
};
