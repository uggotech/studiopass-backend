/**
 * What the listener's app needs to recover from a lost connection during a call:
 *  - GET /call/active  -> the caller's current call (or none)
 *  - a repeated "request a call" for a call that is already waiting returns that call (no second call)
 *  - the operator can renew the Agora token of the call they are on, and nobody else can
 * Real MongoDB (replica set, throwaway DB); no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/call/__tests__/call.recovery.test.ts
 */
import mongoose from "mongoose";
import { CallService } from "../call.service";
import Call from "../call.model";
import { Station } from "../../station/station.model";
import { Country } from "../../country/country.model";
import { User } from "../../user/user.model";
import { CreditBalance } from "../../creditBalance/creditBalance.model";

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

async function rejects(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

async function main() {
  await mongoose.connect(MONGO_URL as string);
  const models: any[] = [Call, Station, Country, User, CreditBalance];
  await Promise.all(models.map((m) => m.deleteMany({})));

  const country = (await Country.collection.insertOne({ name: "Uganda", code: "UG", timezone: "Africa/Kampala", currency: "UGX" })).insertedId;
  const stationA = (await Station.collection.insertOne({ name: "Radio A", stationCode: "RADA", category: "radio", isActive: true, country })).insertedId;
  const stationB = (await Station.collection.insertOne({ name: "Radio B", stationCode: "RADB", category: "radio", isActive: true, country })).insertedId;
  const makeUser = async (name: string, role: string) =>
    (await User.collection.insertOne({ fullName: name, phone: `2567${Math.floor(10000000 + Math.random() * 89999999)}`, countryId: country, role, auth: new mongoose.Types.ObjectId() })).insertedId;
  const listener = await makeUser("Listener", "user");
  const operator = await makeUser("Operator", "media_station");
  const otherOperator = await makeUser("Other Operator", "media_station");
  await CreditBalance.collection.insertOne({ user: listener, balance: 5, paidBalance: 5, freeBalance: 0, createdAt: new Date(), updatedAt: new Date() });

  const newCall = async (fields: Record<string, unknown>) =>
    (await Call.collection.insertOne({ station: stationA, startedBy: listener, agoraChannelId: `ch_${Math.random().toString(36).slice(2)}`, startedAt: new Date(), creditsUsed: 1, country, status: "queued", ...fields })).insertedId;

  console.log("GET /call/active");
  const none: any = await CallService.getActiveCall(String(listener));
  assert(none.call === null, "no call -> null");

  const queuedId = await newCall({ status: "queued" });
  const waiting: any = await CallService.getActiveCall(String(listener));
  assert(waiting.call?.callId === String(queuedId) && waiting.call?.status === "queued", "a waiting call is reported as queued");
  assert(waiting.call?.stationId === String(stationA) && !!waiting.call?.channelName, "it includes the station and channel");

  await Call.collection.updateOne({ _id: queuedId }, { $set: { status: "answered", handledBy: operator } });
  const live: any = await CallService.getActiveCall(String(listener));
  assert(live.call?.status === "answered" && live.call?.operatorName === "Operator", "an answered call includes the operator's name");

  await Call.collection.updateOne({ _id: queuedId }, { $set: { status: "completed" } });
  assert((await CallService.getActiveCall(String(listener)) as any).call === null, "a finished call is not reported");

  console.log("Repeated request for a call that is already waiting");
  const waitingAgain = await newCall({ status: "queued" });
  const balanceBefore = (await CreditBalance.findOne({ user: listener }).lean())?.balance;
  const repeat: any = await CallService.requestCall(String(listener), String(stationA));
  assert(repeat.duplicate === true && repeat.callId === String(waitingAgain), "the same station returns the existing call");
  assert(repeat.status === "queued" && repeat.remainingBalance === balanceBefore, "no extra charge");
  assert((await Call.countDocuments({ startedBy: listener, status: "queued" })) === 1, "still exactly one waiting call");

  const otherStation = await rejects(() => CallService.requestCall(String(listener), String(stationB)));
  assert(otherStation?.statusCode === 409, "a call to a DIFFERENT station is still refused (409)");

  await Call.collection.updateOne({ _id: waitingAgain }, { $set: { status: "answered", handledBy: operator } });
  const whileLive = await rejects(() => CallService.requestCall(String(listener), String(stationA)));
  assert(whileLive?.statusCode === 409, "while a call is live a new request is refused (409)");

  console.log("Operator token renewal");
  const mine: any = await CallService.renewOperatorToken(String(waitingAgain), String(operator));
  assert(typeof mine.token === "string" && mine.token.length > 20, "the operator on the call gets a token");
  assert(mine.channelName.startsWith("ch_") && mine.operatorUid >= 1000000 && mine.operatorUid < 2000000, "same channel, operator uid in the operator range");

  const sameAgain: any = await CallService.renewOperatorToken(String(waitingAgain), String(operator));
  assert(sameAgain.operatorUid === mine.operatorUid, "the uid is stable across renewals (Agora keeps the same user)");

  const stranger = await rejects(() => CallService.renewOperatorToken(String(waitingAgain), String(otherOperator)));
  assert(stranger?.statusCode === 403, "another operator cannot renew it (403)");

  await Call.collection.updateOne({ _id: waitingAgain }, { $set: { status: "completed" } });
  const ended = await rejects(() => CallService.renewOperatorToken(String(waitingAgain), String(operator)));
  assert(ended?.statusCode === 403, "an ended call cannot be renewed (403)");

  const missing = await rejects(() => CallService.renewOperatorToken(String(new mongoose.Types.ObjectId()), String(operator)));
  assert(missing?.statusCode === 404, "an unknown call is 404");

  await Promise.all(models.map((m) => m.deleteMany({})));
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
