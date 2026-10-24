import { logger } from "../../logger/logger";
import { PaymentService } from "./payment.service";
import { DisbursementService } from "../disbursement/disbursement.service";

let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runReconciliation() {
  if (running) return;
  running = true;
  try {
    await PaymentService.reconcilePendingPayments();
    await DisbursementService.processPendingPayouts();
  } catch (err) {
    logger.error("[Payment Reconciler] Run failed:", err);
  } finally {
    running = false;
  }
}

/**
 * Periodically resolves stuck mobile money payments and retries airtime prizes
 * that were never dispatched.
 */
export function startPaymentReconciler(intervalMs = 2 * 60 * 1000) {
  if (reconcileInterval) return;
  reconcileInterval = setInterval(runReconciliation, intervalMs);
}

export function stopPaymentReconciler() {
  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
}
