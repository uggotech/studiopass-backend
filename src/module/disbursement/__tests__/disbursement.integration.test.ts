/**
 * Disbursement integration test: real MongoDB (replica set, throwaway DB),
 * Africa's Talking airtime mocked. No real airtime is sent.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/disbursement/__tests__/disbursement.integration.test.ts
 */
import mongoose from "mongoose";
import * as airtimeModule from "../../../util/africasTalkingAirtime";
import * as airtelModule from "../../payment/airtel.service";
import config from "../../../config";
import { getPayoutLimits, updatePayoutLimits } from "../../payment/payout.settings";
import { DisbursementService } from "../disbursement.service";
import { Disbursement } from "../disbursement.model";
import { Challenge } from "../../challenge/challenge.model";
import { ChallengeParticipation } from "../../challengeParticipation/challengeParticipation.model";
import { Station } from "../../station/station.model";
import { User } from "../../user/user.model";
import { CreditBalance } from "../../creditBalance/creditBalance.model";
import { CreditTransaction } from "../../creditTransaction/creditTransaction.model";

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

// Mock Africa's Talking
const sent: { phoneNumber: string; amount: number; idempotencyKey?: string }[] = [];
(airtimeModule as any).sendAirtime = async (p: any) => {
  sent.push(p);
  return { success: true, status: "Sent", requestId: `ATQid_${sent.length}` };
};

// Mock Airtel disbursement
const airtelPayouts: { msisdn: string; amount: number; transactionId: string }[] = [];
let airtelConfigured = false;
let airtelNextState: "SUCCESS" | "FAILED" | "PENDING" = "SUCCESS";
const airtelStatuses = new Map<string, "SUCCESS" | "FAILED" | "PENDING">();
(airtelModule as any).isAirtelDisbursementConfigured = () => airtelConfigured;
(airtelModule as any).initiateAirtelDisbursement = async (p: any) => {
  airtelPayouts.push(p);
  return airtelNextState === "FAILED"
    ? { state: "FAILED", message: "Insufficient wallet balance" }
    : { state: airtelNextState, airtelMoneyId: `AM-${p.transactionId}` };
};
(airtelModule as any).getAirtelDisbursementStatus = async (id: string) => ({
  state: airtelStatuses.get(id) || "PENDING",
  airtelMoneyId: `AM-${id}`,
});

async function main() {
  await mongoose.connect(MONGO_URL as string);
  const models: any[] = [Disbursement, Challenge, ChallengeParticipation, Station, User, CreditBalance, CreditTransaction];
  await Promise.all(models.map((m) => m.init()));
  await Promise.all(models.map((m) => m.deleteMany({})));

  const station = (await Station.collection.insertOne({ name: "Test Channel", isActive: true })).insertedId;
  const [u1, u2, u3] = Object.values((
    await User.collection.insertMany([
      { fullName: "Winner One", phone: "0771819679", auth: new mongoose.Types.ObjectId() },
      { fullName: "Winner NoPhone", auth: new mongoose.Types.ObjectId() },
      { fullName: "Loser", auth: new mongoose.Types.ObjectId() },
    ])
  ).insertedIds) as any[];

  const makeChallenge = async (prizeTypeKey: string, prizeValue: string) => {
    const id = (
      await Challenge.collection.insertOne({
        station,
        title: `Test ${prizeTypeKey}`,
        prizeTypeKey,
        prizeValue,
        currency: prizeTypeKey === "bonus_credits" ? undefined : "UGX",
        numberOfWinners: 2,
        status: "completed",
      })
    ).insertedId;
    await ChallengeParticipation.collection.insertMany([
      { challenge: id, user: u1, score: 10, timeTaken: 5, createdAt: new Date() },
      { challenge: id, user: u2, score: 9, timeTaken: 5, createdAt: new Date() },
      { challenge: id, user: u3, score: 1, timeTaken: 5, createdAt: new Date() },
    ]);
    return String(id);
  };

  console.log("Airtime prize");
  const airtimeChallenge = await makeChallenge("airtime", "1000");
  await DisbursementService.createDisbursementsForChallenge(airtimeChallenge);
  let rows = await Disbursement.find({ challenge: airtimeChallenge }).lean();
  const r1 = rows.find((r) => String(r.winnerUser) === String(u1));
  const r2 = rows.find((r) => String(r.winnerUser) === String(u2));
  assert(rows.length === 2, "one row per winner (non-winner gets none)");
  assert(sent.length === 1 && sent[0].amount === 1000 && sent[0].idempotencyKey === r1?.txRef, "airtime sent once, with stored txRef as idempotency key");
  assert(r1?.status === "processing" && r1.providerRequestId === "ATQid_1", "row is processing with AT requestId");
  assert(r2?.status === "failed" && /no phone/i.test(r2.failureReason || ""), "winner without phone gets a failed row instead of aborting the run");

  await DisbursementService.createDisbursementsForChallenge(airtimeChallenge);
  assert((await Disbursement.countDocuments({ challenge: airtimeChallenge })) === 2 && sent.length === 1, "re-running creates nothing and sends nothing");

  await DisbursementService.handleAfricasTalkingWebhook({ requestId: "ATQid_1", status: "Success" });
  assert((await Disbursement.findById(r1!._id).lean())?.status === "successful", "AT Success report -> successful");
  await DisbursementService.handleAfricasTalkingWebhook({ requestId: "ATQid_1", status: "Failed", description: "late" });
  assert((await Disbursement.findById(r1!._id).lean())?.status === "successful", "late Failed report cannot overwrite successful");

  console.log("Retry of never-dispatched airtime rows");
  const orphan = await Disbursement.create({
    challenge: new mongoose.Types.ObjectId(),
    winnerUser: u1,
    winnerName: "Winner One",
    phone: "0771819679",
    station,
    prizeTypeKey: "airtime",
    prizeLabel: "Airtime",
    prizeValue: "UGX 500",
    txRef: "DISB-orphan",
    provider: "africas_talking",
    status: "pending",
  });
  await Disbursement.collection.updateOne({ _id: orphan._id }, { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
  await DisbursementService.processPendingPayouts();
  await DisbursementService.processPendingPayouts();
  assert(sent.length === 2 && sent[1].idempotencyKey === "DISB-orphan" && sent[1].amount === 500, "orphan row dispatched exactly once by retry job");

  console.log("Bonus credits prize");
  const creditChallenge = await makeChallenge("bonus_credits", "7");
  await DisbursementService.createDisbursementsForChallenge(creditChallenge);
  await DisbursementService.createDisbursementsForChallenge(creditChallenge);
  const bal1 = (await CreditBalance.findOne({ user: u1 }).lean())?.balance;
  rows = await Disbursement.find({ challenge: creditChallenge }).lean();
  assert(bal1 === 7, "winner credited exactly 7 credits despite re-run");
  assert(rows.every((r) => r.status === "successful"), "credit rows successful");
  assert((await CreditTransaction.countDocuments({ type: "challenge_reward", resourceId: new mongoose.Types.ObjectId(creditChallenge) })) === 2, "one reward ledger row per winner");

  console.log("Mobile money prize");
  // u1 is MTN (0771819679); make u2 an Airtel number so both rails are covered
  await User.collection.updateOne({ _id: u2 }, { $set: { phone: "0701234567" } });

  // 1) Rails not activated yet: rows wait, nothing is sent, and no "paid" message is promised
  const mmWait = await makeChallenge("mobile_money", "5000");
  await DisbursementService.createDisbursementsForChallenge(mmWait);
  rows = await Disbursement.find({ challenge: mmWait }).lean();
  assert(rows.length === 2 && rows.every((r) => r.status === "pending"), "not activated: payouts wait as pending");
  assert(airtelPayouts.length === 0, "not activated: no money sent");

  // 2) Airtel payout activated: Airtel winner paid automatically by the payout job, MTN winner still waits for PayLeo B2C
  airtelConfigured = true;
  airtelNextState = "SUCCESS";
  await Disbursement.collection.updateMany({ challenge: new mongoose.Types.ObjectId(mmWait) }, { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
  await DisbursementService.processPendingPayouts();
  await DisbursementService.processPendingPayouts();
  rows = await Disbursement.find({ challenge: mmWait }).lean();
  const airtelRow = rows.find((r) => String(r.winnerUser) === String(u2))!;
  const mtnRow = rows.find((r) => String(r.winnerUser) === String(u1))!;
  assert(airtelPayouts.length === 1 && airtelPayouts[0].msisdn === "701234567" && airtelPayouts[0].amount === 5000, "Airtel winner paid once with 9-digit msisdn");
  assert(airtelPayouts[0].transactionId === airtelRow.txRef && /^PRZ\d{10}[0-9A-F]{6}$/.test(airtelRow.txRef!), "payout transaction id is the stored txRef (19-char Airtel format)");
  assert(airtelRow.status === "successful" && airtelRow.providerReference === `AM-${airtelRow.txRef}`, "Airtel row successful with operator receipt");
  assert(mtnRow.status === "pending" && /MTN/.test(mtnRow.failureReason || ""), "MTN winner waits for PayLeo payout activation");

  // 3) Payout failure, then admin retry
  const mmFail = await makeChallenge("mobile_money", "3000");
  airtelNextState = "FAILED";
  await DisbursementService.createDisbursementsForChallenge(mmFail);
  const failedRow = (await Disbursement.find({ challenge: mmFail }).lean()).find((r) => String(r.winnerUser) === String(u2))!;
  assert(failedRow.status === "failed" && /Insufficient/.test(failedRow.failureReason || ""), "Airtel rejection marks the row failed with the reason");
  airtelNextState = "SUCCESS";
  const before = airtelPayouts.length;
  const retried: any = await DisbursementService.retryDisbursement(String(failedRow._id));
  assert(retried.status === "successful" && retried.txRef !== failedRow.txRef && airtelPayouts.length === before + 1, "admin retry pays with a NEW transaction id");
  try {
    await DisbursementService.retryDisbursement(String(failedRow._id));
    assert(false, "retry of a successful payout is blocked");
  } catch (e: any) {
    assert((e.statusCode || e.status) === 400 && airtelPayouts.length === before + 1, "retry of a successful payout is blocked (no second payment)");
  }

  // 4) Timeout/unknown outcome is resolved by enquiry, never by sending again
  const mmPending = await makeChallenge("mobile_money", "2000");
  airtelNextState = "PENDING";
  await DisbursementService.createDisbursementsForChallenge(mmPending);
  const inFlight = (await Disbursement.find({ challenge: mmPending }).lean()).find((r) => String(r.winnerUser) === String(u2))!;
  assert(inFlight.status === "processing" && inFlight.providerRequestId === inFlight.txRef, "pending Airtel payout stays processing with its tx id recorded");
  const sentBefore = airtelPayouts.length;
  airtelStatuses.set(inFlight.txRef!, "SUCCESS");
  await Disbursement.collection.updateOne({ _id: inFlight._id }, { $set: { processedAt: new Date(Date.now() - 5 * 60 * 1000) } });
  await DisbursementService.processPendingPayouts();
  assert((await Disbursement.findById(inFlight._id).lean())?.status === "successful" && airtelPayouts.length === sentBefore, "enquiry resolves it to successful without re-sending");

  // 5) Safety limits
  const mmBig = await makeChallenge("mobile_money", String(config.payout.max_per_winner_ugx + 1));
  airtelNextState = "SUCCESS";
  const sentBeforeBig = airtelPayouts.length;
  await DisbursementService.createDisbursementsForChallenge(mmBig);
  rows = await Disbursement.find({ challenge: mmBig }).lean();
  assert(rows.every((r) => r.status === "failed" && /cap/.test(r.failureReason || "")) && airtelPayouts.length === sentBeforeBig, "amount above the per-winner cap is never sent");

  // 6) Daily payout limit: airtime and mobile money share ONE daily total
  console.log("Daily payout limit (airtime + mobile money share one total)");
  const kampalaStart = () => {
    const off = 3 * 60 * 60 * 1000;
    const local = new Date(Date.now() + off);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - off);
  };
  const amountOf = (v: string) => Number(String(v).replace(/[^\d.]/g, "")) || 0;
  const countedToday = async () =>
    (
      await Disbursement.find({
        prizeTypeKey: { $in: ["mobile_money", "airtime"] },
        provider: { $ne: "manual" },
        status: { $in: ["processing", "successful"] },
        processedAt: { $gte: kampalaStart() },
      }).lean()
    ).reduce((sum, r) => sum + amountOf(r.prizeValue), 0);
  const oid = (id: string) => new mongoose.Types.ObjectId(id);
  const makeOld = (filter: Record<string, unknown>) => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    return Disbursement.collection.updateMany(filter, { $set: { createdAt: old, updatedAt: old } });
  };

  const used = await countedToday();
  await updatePayoutLimits({ maxPerWinnerUgx: 1000, dailyLimitUgx: used + 1500 });

  const dailyA = await makeChallenge("airtime", "1000"); // two winners (u1 MTN number, u2 Airtel number)
  const sentBeforeA = sent.length;
  await DisbursementService.createDisbursementsForChallenge(dailyA);
  rows = await Disbursement.find({ challenge: dailyA }).lean();
  assert(sent.length === sentBeforeA + 1 && rows.filter((r) => r.status === "processing").length === 1, "first airtime prize within the daily limit is sent");
  const heldAirtime = rows.find((r) => r.status === "pending");
  assert(
    !!heldAirtime && /Daily payout limit/.test(heldAirtime.failureReason || "") && !heldAirtime.processedAt && !heldAirtime.providerRequestId,
    "airtime prize over the daily limit is held (pending, not sent, nothing recorded as in flight)",
  );

  const dailyB = await makeChallenge("mobile_money", "1000");
  const payoutsBeforeB = airtelPayouts.length;
  await DisbursementService.createDisbursementsForChallenge(dailyB);
  rows = await Disbursement.find({ challenge: dailyB }).lean();
  const heldMoney = rows.find((r) => String(r.winnerUser) === String(u2))!;
  assert(
    airtelPayouts.length === payoutsBeforeB && heldMoney.status === "pending" && /Daily payout limit/.test(heldMoney.failureReason || "") && !heldMoney.providerRequestId,
    "a mobile money prize counts against the same daily total as airtime",
  );

  await updatePayoutLimits({ dailyLimitUgx: (await countedToday()) + 5000 });
  await makeOld({ challenge: { $in: [oid(dailyA), oid(dailyB)] }, status: "pending" });
  const sentBeforeRelease = sent.length;
  const payoutsBeforeRelease = airtelPayouts.length;
  await DisbursementService.processPendingPayouts();
  assert(sent.length === sentBeforeRelease + 1, "held airtime prize is sent automatically once the limit allows it");
  assert(airtelPayouts.length === payoutsBeforeRelease + 1, "held mobile money prize is paid automatically once the limit allows it");

  // The per-winner cap now comes from the Super Admin setting and also covers airtime
  const capChallenge = await makeChallenge("airtime", "1001");
  const sentBeforeCap = sent.length;
  await DisbursementService.createDisbursementsForChallenge(capChallenge);
  rows = await Disbursement.find({ challenge: capChallenge }).lean();
  assert(
    rows.length === 2 && rows.every((r) => r.status === "failed" && /cap/.test(r.failureReason || "")) && sent.length === sentBeforeCap,
    "airtime above the per-winner cap (set by the Super Admin) is never sent",
  );

  // 7) Manual "mark as paid" (MTN winners until MTN payouts are automated)
  console.log("Manual 'mark as paid'");
  const adminId = String(new mongoose.Types.ObjectId());
  const marked: any = await DisbursementService.markPaidManually(
    String(mtnRow._id),
    { reference: "MTN-TXN-12345", note: "Paid by accounts" },
    adminId,
  );
  assert(
    marked.status === "successful" && marked.provider === "manual" && marked.providerReference === "MTN-TXN-12345" &&
      String(marked.markedPaidBy) === adminId && marked.markedPaidAt && marked.manualNote === "Paid by accounts",
    "pending MTN prize can be recorded as paid, with reference, note and who did it",
  );
  try {
    await DisbursementService.markPaidManually(String(mtnRow._id), { reference: "AGAIN-999" }, adminId);
    assert(false, "marking an already-paid prize again is blocked");
  } catch (e: any) {
    assert((e.statusCode || e.status) === 409, "marking an already-paid prize again is blocked (409)");
  }
  assert((await Disbursement.findById(mtnRow._id).lean())?.providerReference === "MTN-TXN-12345", "the original payment reference is untouched");

  const inFlightRow = await Disbursement.create({
    challenge: new mongoose.Types.ObjectId(), winnerUser: u2, winnerName: "Winner Two", phone: "0701234567", station,
    prizeTypeKey: "mobile_money", prizeLabel: "Cash", prizeValue: "UGX 100", txRef: "PRZ-inflight", provider: "airtel_money",
    providerRequestId: "PRZ-inflight", status: "processing", processedAt: new Date(),
  });
  try {
    await DisbursementService.markPaidManually(String(inFlightRow._id), { reference: "NOPE-123" }, adminId);
    assert(false, "a payout that is in flight cannot be marked paid");
  } catch (e: any) {
    assert((e.statusCode || e.status) === 409, "a payout that is in flight cannot be marked paid (no double payment)");
  }
  try {
    await DisbursementService.markPaidManually(String(heldAirtime!._id), { reference: "NOPE-123" }, adminId);
    assert(false, "only mobile money prizes can be marked paid");
  } catch (e: any) {
    assert((e.statusCode || e.status) === 400, "airtime prizes cannot be marked paid manually");
  }
  const otherPartnerRow = (await Disbursement.find({ challenge: dailyB, prizeTypeKey: "mobile_money" }).lean()).find((r) => r.status === "pending");
  if (otherPartnerRow) {
    try {
      await DisbursementService.markPaidManually(String(otherPartnerRow._id), { reference: "SCOPE-123" }, adminId, { partnerId: String(new mongoose.Types.ObjectId()) });
      assert(false, "admins cannot touch prizes outside their partner");
    } catch (e: any) {
      assert((e.statusCode || e.status) === 404, "admins cannot touch prizes outside their partner (404)");
    }
  }

  // 8) Manual payments are not counted, and two payout runs at once cannot exceed the limit
  console.log("Concurrent payout runs");
  await updatePayoutLimits({ dailyLimitUgx: (await countedToday()) + 1000 });
  const raceRows = await Disbursement.insertMany(
    [1, 2].map((n) => ({
      challenge: new mongoose.Types.ObjectId(), winnerUser: u1, winnerName: "Winner One", phone: "0771819679", station,
      prizeTypeKey: "airtime", prizeLabel: "Airtime", prizeValue: "UGX 1000", txRef: `DISB-race-${n}`, provider: "africas_talking", status: "pending",
    })),
  );
  await makeOld({ _id: { $in: raceRows.map((r) => r._id) } });
  const sentBeforeRace = sent.length;
  await Promise.all([DisbursementService.processPendingPayouts(), DisbursementService.processPendingPayouts()]);
  const afterRace = await Disbursement.find({ _id: { $in: raceRows.map((r) => r._id) } }).lean();
  assert(
    sent.length === sentBeforeRace + 1,
    "with room for exactly one prize, two payout runs at once send exactly one (manual payments are not counted)",
  );
  assert(
    afterRace.filter((r) => r.status === "processing").length === 1 && afterRace.filter((r) => r.status === "pending").length === 1,
    "the other prize waits for the next run",
  );
  assert((await countedToday()) <= (await getPayoutLimits()).dailyLimitUgx, "the daily total never exceeds the limit");

  await mongoose.connection.db!.dropDatabase();
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
