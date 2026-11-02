/**
 * Payment integration test: real MongoDB (replica set, throwaway DB), real Express app,
 * mocked Airtel API. No real provider is contacted.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child src/module/payment/__tests__/payment.integration.test.ts
 */
import http from "http";
import { AddressInfo } from "net";
import crypto from "crypto";
import mongoose from "mongoose";
import config from "../../../config";
import app from "../../../app";
import { PaymentTransaction } from "../payment.model";
import { PaymentService, setReceiptSender } from "../payment.service";
import { PaymentAdminService } from "../payment.admin.service";
import { CreditPackage } from "../payment.package.model";
import { findCreditPackage } from "../payment.packages";
import { getPayoutLimits } from "../payout.settings";
import { CreditBalance } from "../../creditBalance/creditBalance.model";
import { CreditTransaction } from "../../creditTransaction/creditTransaction.model";
import { User } from "../../user/user.model";

const MONGO_URL = process.env.PAYTEST_MONGO_URL;
if (!MONGO_URL || !/paytest/.test(MONGO_URL)) {
  console.error("Set PAYTEST_MONGO_URL to a throwaway database whose name contains 'paytest'.");
  process.exit(1);
}

let passed = 0;
let total = 0;
function assert(condition: boolean, name: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
  }
}

const listen = (server: http.Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );

// ── Mock Airtel: token + enquiry. enquiryStatus maps txId -> TS/TF/TIP ──
const enquiryStatus = new Map<string, string>();
const airtelMock = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url?.startsWith("/auth/oauth2/token")) {
    res.end(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }));
    return;
  }
  const m = req.url?.match(/\/standard\/v1\/payments\/(.+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    res.end(
      JSON.stringify({
        data: { transaction: { id, status: enquiryStatus.get(id) || "TIP", airtel_money_id: `AM-${id}`, message: "mock" } },
        status: { success: true, code: "200" },
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end("{}");
});

const balanceOf = async (userId: string) => (await CreditBalance.findOne({ user: userId }).lean())?.balance ?? 0;
const purchaseCount = (txId: string) => CreditTransaction.countDocuments({ paymentReference: txId, type: "purchase" });

const payleoXml = (method: string, txId: string, amount: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><request><method>${method}</method><msisdn>256771819679</msisdn>` +
  `<transactionId>${txId}</transactionId><referenceId>32432432423423222</referenceId><amount>${amount}</amount></request>`;

async function main() {
  await mongoose.connect(MONGO_URL as string);
  await Promise.all([PaymentTransaction.init(), CreditBalance.init(), CreditTransaction.init(), User.init(), CreditPackage.init()]);
  await Promise.all(
    [PaymentTransaction, CreditBalance, CreditTransaction, User, CreditPackage].map((m: any) => m.deleteMany({})),
  );

  // Never reach Africa's Talking from a test: capture receipts instead
  const receipts: { to: string; message: string }[] = [];
  setReceiptSender(async (to, message) => {
    receipts.push({ to, message });
  });
  const settle = () => new Promise((r) => setTimeout(r, 150)); // receipts are sent in the background

  const mockBase = await listen(airtelMock);
  (config.airtel as any).token_url = `${mockBase}/auth/oauth2/token`;
  (config.airtel as any).status_url = `${mockBase}/standard/v1/payments/`;
  (config.airtel as any).client_id = "mock";
  (config.airtel as any).client_secret = "mock";
  (config.payleo as any).forward_secret = "fwd-secret";

  const apiServer = http.createServer(app);
  const api = await listen(apiServer);

  const userInsert = await User.collection.insertOne({ fullName: "Pay Test", createdAt: new Date() });
  const userId = String(userInsert.insertedId);

  const newPayment = (provider: "payleo" | "airtel", transactionId: string, amount = 500, credits = 1) =>
    PaymentTransaction.create({
      user: userInsert.insertedId,
      provider,
      carrier: provider === "payleo" ? "MTN" : "AIRTEL",
      phoneNumber: "+256771819679",
      amount,
      currency: "UGX",
      creditsToGrant: credits,
      packageId: "pkg_500",
      transactionId,
      status: "pending",
    });

  console.log("Credit packages (managed by the Super Admin, nothing hard-coded)");
  const actor = { userId };
  assert((await PaymentService.getPackages()).length === 0, "no packages exist until the Super Admin creates one");

  const pStarter = await PaymentAdminService.createPackage({ label: "Starter", amountUgx: 500, credits: 1 }, actor);
  const pBig = await PaymentAdminService.createPackage({ label: "Big", amountUgx: 10000, credits: 20, sortOrder: 5 }, actor);
  const pMid = await PaymentAdminService.createPackage({ label: "Mid", amountUgx: 2000, credits: 4 }, actor);
  let shown = await PaymentService.getPackages();
  assert(
    shown.length === 3 && shown[0].amountUgx === 500 && shown[1].amountUgx === 2000 && shown[2].amountUgx === 10000,
    "app sees the packages ordered by sort order then price",
  );
  assert(
    Object.keys(shown[0]).sort().join() === "amountUgx,credits,id,label",
    "app only receives id, amountUgx, credits, label",
  );

  for (const [bad, why] of [
    [{ label: "x", amountUgx: 50, credits: 1 }, "price below UGX 100"],
    [{ label: "x", amountUgx: 500.5, credits: 1 }, "fractional price"],
    [{ label: "x", amountUgx: 500, credits: 0 }, "zero credits"],
    [{ label: "x", amountUgx: 500, credits: 1.5 }, "fractional credits"],
  ] as const) {
    try {
      await PaymentAdminService.createPackage(bad as any, actor);
      assert(false, `rejects ${why}`);
    } catch {
      assert(true, `rejects ${why}`);
    }
  }
  assert((await CreditPackage.countDocuments({})) === 3, "rejected packages are not saved");

  await PaymentAdminService.updatePackage(pMid.id, { amountUgx: 2500, credits: 5 }, actor);
  const edited = await findCreditPackage(pMid.id);
  assert(edited?.amountUgx === 2500 && edited.credits === 5, "price and credits can be edited");

  await PaymentAdminService.updatePackage(pBig.id, { isActive: false }, actor);
  shown = await PaymentService.getPackages();
  assert(shown.length === 2 && !shown.some((p) => p.id === pBig.id), "deactivated package disappears from the app");
  assert((await PaymentAdminService.listPackages()).length === 3, "Super Admin still sees deactivated packages");
  assert((await findCreditPackage(pBig.id)) === undefined, "a deactivated package cannot be bought");

  await PaymentAdminService.updatePackage(pBig.id, { isActive: true }, actor);
  assert((await findCreditPackage(pBig.id))?.credits === 20, "package can be re-activated");

  try {
    await PaymentAdminService.updatePackage(String(new mongoose.Types.ObjectId()), { label: "Ghost" }, actor);
    assert(false, "editing an unknown package fails");
  } catch (e: any) {
    assert((e.statusCode || e.status) === 404, "editing an unknown package returns 404");
  }

  console.log("Initiate validation (no network)");
  await PaymentAdminService.updatePackage(pBig.id, { isActive: false }, actor);
  for (const [id, why] of [
    ["pkg_500", "old-style package id"],
    [String(new mongoose.Types.ObjectId()), "unknown package id"],
    [pBig.id, "deactivated package"],
  ] as const) {
    try {
      await PaymentService.initiatePayment(userId, { packageId: id, phoneNumber: "0771819679" });
      assert(false, `${why} rejected`);
    } catch (e: any) {
      assert((e.statusCode || e.status) === 400, `${why} rejected with 400`);
    }
  }
  assert((await PaymentTransaction.countDocuments({})) === 0, "rejected purchases create no payment records");

  console.log("Payout limits (Super Admin)");
  const defaults = await getPayoutLimits();
  assert(defaults.maxPerWinnerUgx === 200000 && defaults.dailyLimitUgx === 500000, "defaults are 200,000 per winner and 500,000 per day");
  const updatedLimits = await PaymentAdminService.updateLimits({ dailyLimitUgx: 750000 }, actor);
  assert(updatedLimits.dailyLimitUgx === 750000 && updatedLimits.maxPerWinnerUgx === 200000, "daily limit can be changed on its own");
  assert((await getPayoutLimits()).dailyLimitUgx === 750000, "new limit is used immediately");
  for (const [patch, why] of [
    [{ maxPerWinnerUgx: 0 }, "zero per-winner cap"],
    [{ maxPerWinnerUgx: 1000.5 }, "fractional cap"],
    [{ dailyLimitUgx: -1 }, "negative daily limit"],
    [{ dailyLimitUgx: 100000 }, "daily limit below the per-winner cap"],
  ] as const) {
    try {
      await PaymentAdminService.updateLimits(patch, actor);
      assert(false, `rejects ${why}`);
    } catch (e: any) {
      assert((e.statusCode || e.status) === 400, `rejects ${why}`);
    }
  }
  assert((await getPayoutLimits()).dailyLimitUgx === 750000, "rejected limits change nothing");
  await PaymentAdminService.updateLimits({ dailyLimitUgx: 0 }, actor);
  assert((await getPayoutLimits()).dailyLimitUgx === 0, "0 means no daily limit");
  await PaymentAdminService.updateLimits({ dailyLimitUgx: 500000 }, actor);

  console.log("PayLeo webhook over HTTP");
  const tx1 = "100000000000001";
  await newPayment("payleo", tx1);

  let r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("receivePayment", tx1, "100"),
  });
  assert(r.status === 200 && (await r.text()).includes("<code>200</code>"), "wrong-amount callback acknowledged");
  assert((await balanceOf(userId)) === 0, "wrong amount grants no credits");
  assert((await PaymentTransaction.findOne({ transactionId: tx1 }).lean())?.status === "failed", "wrong amount marks payment failed");

  // Five concurrent genuine callbacks, sent as form-urlencoded raw XML (worst-case content type)
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      fetch(`${api}/api/v1/payment/webhook/payleo`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payleoXml("receivePayment", tx1, "500.00"),
      }),
    ),
  );
  assert(results.every((x) => x.status === 200), "all 5 concurrent callbacks acknowledged");
  assert((await balanceOf(userId)) === 1, "5 concurrent callbacks credit exactly once");
  assert((await purchaseCount(tx1)) === 1, "exactly one purchase ledger row");
  await settle();
  assert(receipts.length === 1, "5 concurrent callbacks send exactly one SMS receipt");
  assert(
    receipts[0]?.to === "+256771819679" &&
      receipts[0].message.includes("UGX 500 received") &&
      receipts[0].message.includes("1 credit added") &&
      receipts[0].message.includes("Balance: 1") &&
      receipts[0].message.includes(`Ref ${tx1.slice(-6)}`) &&
      receipts[0].message.length <= 160,
    "receipt goes to the paying number, states amount, credits and new balance, fits one SMS",
  );
  assert(r.headers.get("content-type")?.includes("application/xml") === true, "response is application/xml");

  r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("notifyFailedPayment", tx1, "500"),
  });
  assert((await PaymentTransaction.findOne({ transactionId: tx1 }).lean())?.status === "completed", "late failure never downgrades a completed payment");

  r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("receivePayment", "999999999999999", "500"),
  });
  assert(r.status === 200, "unknown transaction acknowledged");
  assert((await balanceOf(userId)) === 1, "unknown transaction grants nothing");

  console.log("PayLeo forwarder (JSON + signature)");
  const tx2 = "100000000000002";
  await newPayment("payleo", tx2);
  const fwd = JSON.stringify({ status: "SUCCESS", method: "receivePayment", msisdn: "256771819679", transactionId: tx2, amount: "500" });
  r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-StudioPass-Signature": "deadbeef" },
    body: fwd,
  });
  assert(r.status === 401 && (await balanceOf(userId)) === 1, "forged forwarder signature rejected, no credit");
  r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-StudioPass-Signature": crypto.createHmac("sha256", "fwd-secret").update(fwd).digest("hex"),
    },
    body: fwd,
  });
  assert(r.status === 200 && (await balanceOf(userId)) === 2, "valid forwarder callback credits");

  console.log("Airtel webhook (verified via enquiry)");
  const tx3 = "TXN1700000000AAAAAA";
  await newPayment("airtel", tx3);
  enquiryStatus.set(tx3, "TF"); // Airtel says it failed
  r = await fetch(`${api}/api/v1/payment/webhook/airtel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: { id: tx3, status_code: "TS", airtel_money_id: "X" } }),
  });
  assert(r.status === 200, "forged TS callback acknowledged");
  assert((await balanceOf(userId)) === 2, "forged TS callback (enquiry=TF) grants nothing");
  assert((await PaymentTransaction.findOne({ transactionId: tx3 }).lean())?.status === "failed", "forged TS callback marks payment failed");

  const tx4 = "TXN1700000000BBBBBB";
  await newPayment("airtel", tx4);
  enquiryStatus.set(tx4, "TIP");
  await fetch(`${api}/api/v1/payment/webhook/airtel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: { id: tx4, status_code: "TS" } }),
  });
  assert((await PaymentTransaction.findOne({ transactionId: tx4 }).lean())?.status === "pending", "TS callback with enquiry still in progress stays pending");

  enquiryStatus.set(tx4, "TS");
  await Promise.all(
    Array.from({ length: 3 }, () =>
      fetch(`${api}/api/v1/payment/webhook/airtel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: { id: tx4, status_code: "TS" } }),
      }),
    ),
  );
  assert((await balanceOf(userId)) === 3, "3 concurrent genuine TS callbacks credit exactly once");
  const p4 = await PaymentTransaction.findOne({ transactionId: tx4 }).lean();
  assert(p4?.status === "completed" && p4.providerReference === `AM-${tx4}`, "airtel_money_id stored from enquiry");

  console.log("Reconciler");
  const tx5 = "TXN1700000000CCCCCC";
  await newPayment("airtel", tx5);
  await PaymentTransaction.collection.updateOne({ transactionId: tx5 }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
  enquiryStatus.set(tx5, "TS");
  const tx6 = "100000000000006";
  await newPayment("payleo", tx6);
  await PaymentTransaction.collection.updateOne({ transactionId: tx6 }, { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
  await PaymentService.reconcilePendingPayments();
  assert((await balanceOf(userId)) === 4, "reconciler credits an Airtel payment whose callback was lost");
  assert((await PaymentTransaction.findOne({ transactionId: tx6 }).lean())?.status === "failed", "reconciler times out an old PayLeo payment");

  r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("receivePayment", tx6, "500"),
  });
  assert((await balanceOf(userId)) === 5, "late PayLeo success after timeout is still credited");

  console.log("Status endpoint (service)");
  const status = await PaymentService.getPaymentStatus(userId, tx1);
  assert(status.status === "completed" && status.credits === 1, "owner sees their payment status");
  try {
    await PaymentService.getPaymentStatus(String(new mongoose.Types.ObjectId()), tx1);
    assert(false, "other users cannot see the payment");
  } catch (e: any) {
    assert(e.statusCode === 404 || e.status === 404, "other users get 404");
  }

  console.log("Airtel callback authentication (enforce mode)");
  (config.airtel as any).callback_hash_key = "int-test-hash-key";
  (config.airtel as any).callback_auth_mode = "enforce";
  const signBody = (tx: object, key: string) => {
    const base = JSON.stringify({ transaction: tx });
    const h = crypto.createHmac("sha256", key).update(base).digest("base64");
    return `${base.slice(0, -1)},"hash":"${h}"}`;
  };
  const post = (body: string) =>
    fetch(`${api}/api/v1/payment/webhook/airtel`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const tx7 = "TXN1700000000DDDDDD";
  await newPayment("airtel", tx7);
  enquiryStatus.set(tx7, "TIP"); // Airtel's enquiry would NOT confirm: only a valid signature can credit
  const balBefore = await balanceOf(userId);

  r = await post(JSON.stringify({ transaction: { id: tx7, status_code: "TS", airtel_money_id: "X" } }));
  assert(r.status === 403 && (await balanceOf(userId)) === balBefore, "unsigned callback rejected (403), no credit");
  r = await post(signBody({ id: tx7, status_code: "TS", airtel_money_id: "X" }, "some-other-key"));
  assert(r.status === 403 && (await balanceOf(userId)) === balBefore, "callback signed with the wrong key rejected, no credit");
  assert((await PaymentTransaction.findOne({ transactionId: tx7 }).lean())?.status === "pending", "rejected callbacks leave the payment pending");

  r = await post(signBody({ status_code: "TS", code: "DP00800001001", airtel_money_id: "AM7", id: tx7, message: "PAID" }, "int-test-hash-key"));
  assert(r.status === 200 && (await balanceOf(userId)) === balBefore + 1, "correctly signed TS callback credits (extra `code` field included)");
  assert((await PaymentTransaction.findOne({ transactionId: tx7 }).lean())?.providerReference === "AM7", "airtel_money_id stored from the signed callback");
  r = await post(signBody({ status_code: "TS", code: "DP00800001001", airtel_money_id: "AM7", id: tx7, message: "PAID" }, "int-test-hash-key"));
  assert(r.status === 200 && (await balanceOf(userId)) === balBefore + 1, "replayed signed callback credits nothing more");

  const tx8 = "TXN1700000000EEEEEE";
  await newPayment("airtel", tx8);
  r = await post(signBody({ status_code: "TF", airtel_money_id: "AM8", id: tx8, message: "FAILED. Insufficient funds." }, "int-test-hash-key"));
  assert((await PaymentTransaction.findOne({ transactionId: tx8 }).lean())?.status === "failed", "correctly signed TF callback marks the payment failed");

  (config.airtel as any).callback_auth_mode = "log";
  const tx9 = "TXN1700000000FFFFFF";
  await newPayment("airtel", tx9);
  enquiryStatus.set(tx9, "TIP");
  r = await post(JSON.stringify({ transaction: { id: tx9, status_code: "TS", airtel_money_id: "X" } }));
  assert(r.status === 200 && (await PaymentTransaction.findOne({ transactionId: tx9 }).lean())?.status === "pending", "log mode: unsigned callback accepted but still needs Airtel's enquiry to confirm");

  console.log("IP allowlist");
  (config.airtel as any).callback_ips = "41.223.87.244";
  // Allowlist is read when the route module is built, so exercise the middleware directly
  const { PaymentController } = await import("../payment.controller");
  const mw = PaymentController.ipAllowlist("airtel");
  let blocked = false;
  await new Promise<void>((resolve) =>
    mw(
      { ip: "10.0.0.9" } as any,
      { status: () => ({ json: () => { blocked = true; resolve(); } }) } as any,
      () => resolve(),
    ),
  );
  assert(blocked, "non-allowlisted IP is rejected");
  let allowed = false;
  mw({ ip: "::ffff:41.223.87.244" } as any, {} as any, () => { allowed = true; });
  assert(allowed, "allowlisted IP passes (IPv4-mapped form)");

  console.log("SMS receipt never affects the payment");
  const receiptsBefore = receipts.length;
  setReceiptSender(async () => {
    throw new Error("Africa's Talking is down");
  });
  const txR1 = "100000000000011";
  await newPayment("payleo", txR1);
  const balR = await balanceOf(userId);
  r = await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("receivePayment", txR1, "500"),
  });
  await settle();
  assert(
    r.status === 200 && (await balanceOf(userId)) === balR + 1 && (await PaymentTransaction.findOne({ transactionId: txR1 }).lean())?.status === "completed",
    "a failing SMS provider does not stop the payment from completing",
  );

  setReceiptSender(async (to, message) => {
    receipts.push({ to, message });
  });
  (config as any).payment_receipt_sms = false;
  const txR2 = "100000000000012";
  await newPayment("payleo", txR2);
  await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("receivePayment", txR2, "500"),
  });
  await settle();
  assert(receipts.length === receiptsBefore, "PAYMENT_RECEIPT_SMS=false sends no receipt");
  (config as any).payment_receipt_sms = true;
  const txR3 = "100000000000013";
  await newPayment("payleo", txR3);
  await fetch(`${api}/api/v1/payment/webhook/payleo`, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body: payleoXml("receivePayment", txR3, "500"),
  });
  await settle();
  assert(receipts.length === receiptsBefore + 1, "receipts resume when switched back on");
  assert(!receipts.some((x) => x.message.includes(txR2.slice(-6)) && x.message.includes("Ref 000012")), "no receipt for the payment completed while switched off");

  try {
    const { default: redisClient } = await import("../../../redis/redisClient");
    await redisClient.del("airtel:oauth:token"); // do not leave the mock token in the dev Redis
  } catch {}
  await mongoose.connection.db!.dropDatabase();
  apiServer.close();
  airtelMock.close();
  await mongoose.disconnect();

  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.connection.db?.dropDatabase();
  } catch {}
  process.exit(1);
});
