/**
 * A retry of a message send (same clientMessageId) must never create a second message
 * or charge a second credit. Real MongoDB (replica set, throwaway DB); no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/message/__tests__/message.idempotency.test.ts
 */
import mongoose from "mongoose";
import { MessageService } from "../message.service";
import Message from "../message.model";
import { Station } from "../../station/station.model";
import { Country } from "../../country/country.model";
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

async function main() {
  await mongoose.connect(MONGO_URL as string);
  const models: any[] = [Message, Station, Country, User, CreditBalance, CreditTransaction];
  await Promise.all(models.map((m) => m.init())); // builds the unique clientMessageId index
  await Promise.all(models.map((m) => m.deleteMany({})));

  const country = (
    await Country.collection.insertOne({ name: "Uganda", code: "UG", timezone: "Africa/Kampala", currency: "UGX", messageCreditPrice: 500, callCreditPrice: 500 })
  ).insertedId;
  const station = String(
    (await Station.collection.insertOne({ name: "Test Channel", category: "channel", channelType: "message_chat", isActive: true, country })).insertedId,
  );
  const makeUser = async (phone: string, balance: number) => {
    const id = (await User.collection.insertOne({ fullName: `U ${phone}`, phone, countryId: country, role: "user", auth: new mongoose.Types.ObjectId() })).insertedId;
    await CreditBalance.collection.insertOne({ user: id, balance, paidBalance: balance, freeBalance: 0, createdAt: new Date(), updatedAt: new Date() });
    return String(id);
  };
  const alice = await makeUser("0771819679", 8);
  const bob = await makeUser("0701234567", 3);

  const balanceOf = async (id: string) => (await CreditBalance.findOne({ user: id }).lean())?.balance ?? -1;
  const messageCount = (user: string, clientMessageId?: string) =>
    Message.countDocuments(clientMessageId ? { user, clientMessageId } : { user });
  const deductions = (user: string) => CreditTransaction.countDocuments({ user, type: "message_deduction" });
  const send = (user: string, content: string, clientMessageId?: string) =>
    MessageService.sendUserMessage(station, content, user, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clientMessageId);

  console.log("Retry with the same clientMessageId");
  const first: any = await send(alice, "Hello station", "client-id-0001");
  assert(!first.duplicate && (await balanceOf(alice)) === 7 && (await messageCount(alice)) === 1 && (await deductions(alice)) === 1, "first send saves one message and charges one credit");

  const retry: any = await send(alice, "Hello station", "client-id-0001");
  assert(String(retry.message.id) === String(first.message.id) && retry.duplicate === true, "retry returns the original message");
  assert(retry.remainingBalance === 7, "retry reports the current balance");
  assert((await balanceOf(alice)) === 7 && (await messageCount(alice)) === 1 && (await deductions(alice)) === 1, "retry creates no second message and charges nothing");

  const retryOtherText: any = await send(alice, "Edited text", "client-id-0001");
  assert(String(retryOtherText.message.id) === String(first.message.id) && retryOtherText.message.content === "Hello station", "the same id always returns the originally saved message");

  console.log("Different attempts are different messages");
  await send(alice, "Hello station", "client-id-0002");
  assert((await messageCount(alice)) === 2 && (await balanceOf(alice)) === 6, "a new clientMessageId is a new message (one more credit)");
  await send(alice, "Old app, no id");
  await send(alice, "Old app, no id");
  assert((await messageCount(alice)) === 4 && (await balanceOf(alice)) === 4, "sends without an id behave exactly as before");

  console.log("Scoped per listener");
  const bobMsg: any = await send(bob, "Hi from Bob", "client-id-0001");
  assert(!bobMsg.duplicate && String(bobMsg.message.id) !== String(first.message.id) && (await balanceOf(bob)) === 2, "another listener using the same id is not treated as a duplicate");

  console.log("Five identical sends at the same moment");
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => send(alice, "Race", "client-id-race")));
  const fulfilled = results.filter((x) => x.status === "fulfilled") as PromiseFulfilledResult<any>[];
  assert(fulfilled.length >= 1, "at least one concurrent send succeeds");
  assert(new Set(fulfilled.map((x) => String(x.value.message.id))).size === 1, "every send that succeeds returns the same message");
  assert((await messageCount(alice, "client-id-race")) === 1, "exactly one message is saved");
  assert((await balanceOf(alice)) === 3, "exactly one credit is charged for the five sends");
  const afterRace: any = await send(alice, "Race", "client-id-race");
  assert(afterRace.duplicate === true && (await balanceOf(alice)) === 3, "a later retry is recognised as a duplicate");

  console.log("Failures are not remembered");
  const broke = await makeUser("0751234567", 0);
  try {
    await send(broke, "No credits", "client-id-broke");
    assert(false, "send without credits is refused");
  } catch (e: any) {
    assert((e.statusCode || e.status) === 400, "send without credits is refused (400)");
  }
  assert((await messageCount(broke)) === 0, "a refused send leaves no message behind");
  await CreditBalance.collection.updateOne({ user: new mongoose.Types.ObjectId(broke) }, { $set: { balance: 2, paidBalance: 2 } });
  const topped: any = await send(broke, "No credits", "client-id-broke");
  assert(!topped.duplicate && (await balanceOf(broke)) === 1, "after topping up, the same id sends normally");

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
