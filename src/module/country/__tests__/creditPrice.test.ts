/**
 * The Uganda credit price (1 credit = UGX 250) must survive a server restart and feed
 * usage records, listener statements and listener spend correctly.
 * Real MongoDB (replica set, throwaway DB); no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/country/__tests__/creditPrice.test.ts
 */
import mongoose from "mongoose";
import seedCountries from "../../../db/seedCountries";
import { Country } from "../country.model";
import { CreditService } from "../../credit/credit.service";
import { ListenerStatementService } from "../../listenerStatement/listenerStatement.service";
import ListenerStatement from "../../listenerStatement/listenerStatement.model";
import { UserService } from "../../user/user.service";
import { User } from "../../user/user.model";
import { Station } from "../../station/station.model";
import Call from "../../call/call.model";
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
  await mongoose.connection.db!.dropDatabase();

  console.log("Seed at server start");
  await seedCountries();
  const count = await Country.countDocuments();
  const uganda = await Country.findOne({ code: "UG" }).lean();
  assert(count === 10, "an empty database gets all countries");
  assert(uganda?.messageCreditPrice === 250 && uganda?.callCreditPrice === 250, "a new Uganda starts at UGX 250 per credit");

  await Country.updateOne({ code: "UG" }, { $set: { messageCreditPrice: 300, callCreditPrice: 350 } });
  await Country.updateOne({ code: "KE" }, { $set: { isActive: false } });
  await Country.deleteOne({ code: "NG" });
  await seedCountries();
  const afterRestart = await Country.findOne({ code: "UG" }).lean();
  assert(afterRestart?.messageCreditPrice === 300 && afterRestart?.callCreditPrice === 350, "a restart keeps the price set in the dashboard");
  assert((await Country.findOne({ code: "KE" }).lean())?.isActive === false, "a restart keeps a country's active status");
  assert((await Country.countDocuments({ code: "NG" })) === 1, "a restart recreates a missing country");
  assert((await Country.countDocuments()) === count, "a restart adds no duplicates");

  // An old database still holding 500: the dashboard change to 250 is what takes effect
  await Country.updateOne({ code: "UG" }, { $set: { messageCreditPrice: 500, callCreditPrice: 500 } });
  await seedCountries();
  assert((await Country.findOne({ code: "UG" }).lean())?.messageCreditPrice === 500, "an existing country is not changed by the seed");
  await Country.updateOne({ code: "UG" }, { $set: { messageCreditPrice: 250, callCreditPrice: 250 } });

  const country = uganda!._id;
  const station = (
    await Station.collection.insertOne({ name: "Test FM", stationCode: "RS-T01", category: "radio", isActive: true, country })
  ).insertedId;
  const makeUser = async (phone: string, balance: number) => {
    const id = (await User.collection.insertOne({ fullName: `U ${phone}`, phone, countryId: country, role: "user", auth: new mongoose.Types.ObjectId() })).insertedId;
    await CreditBalance.collection.insertOne({ user: id, balance, paidBalance: balance, freeBalance: 0, createdAt: new Date(), updatedAt: new Date() });
    return String(id);
  };
  const lastUsage = (user: string, type: string) =>
    CreditTransaction.findOne({ user, type }).sort({ createdAt: -1 }).lean();
  const purchase = (user: string, credits: number, money: number | undefined) =>
    CreditTransaction.collection.insertOne({
      user: new mongoose.Types.ObjectId(user),
      type: "purchase",
      amount: credits,
      isFree: false,
      status: "completed",
      ...(money === undefined ? {} : { localAmount: money }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  console.log("Usage records");
  const buyer = await makeUser("0771819679", 20);
  await purchase(buyer, 20, 5000);
  const stationId = String(station);
  const resource = () => String(new mongoose.Types.ObjectId());
  await CreditService.deductCredits(buyer, 1, stationId, resource(), "message");
  assert((await lastUsage(buyer, "message_deduction"))?.localAmount === 250, "a paid message is recorded at UGX 250");
  await CreditService.deductCredits(buyer, 1, stationId, resource(), "call");
  assert((await lastUsage(buyer, "call_deduction"))?.localAmount === 250, "a paid call is recorded at UGX 250");
  await CreditService.deductCredits(buyer, 2, stationId, resource(), "challenge");
  assert((await lastUsage(buyer, "challenge_deduction"))?.localAmount === 500, "2 credits on a challenge are recorded at UGX 500");
  await CreditService.deductCredits(buyer, 1, stationId, resource(), "poll");
  assert((await lastUsage(buyer, "poll_deduction"))?.localAmount === 250, "a paid poll vote is recorded at UGX 250");

  console.log("Listener statements");
  const call = (
    await Call.collection.insertOne({ station, startedBy: new mongoose.Types.ObjectId(buyer), status: "completed", creditsUsed: 1, createdAt: new Date(), updatedAt: new Date() })
  ).insertedId;
  await ListenerStatementService.createStatementFromCall(String(call), false);
  const paidStatement = await ListenerStatement.findOne({ sourceId: call }).lean();
  assert(paidStatement?.amount === 250 && paidStatement?.currency === "UGX", "a paid call statement shows UGX 250");
  const freeCall = (
    await Call.collection.insertOne({ station, startedBy: new mongoose.Types.ObjectId(buyer), status: "completed", creditsUsed: 1, createdAt: new Date(), updatedAt: new Date() })
  ).insertedId;
  await ListenerStatementService.createStatementFromCall(String(freeCall), true);
  assert((await ListenerStatement.findOne({ sourceId: freeCall }).lean())?.amount === 0, "a free call statement shows 0");

  console.log("Purchases are not touched by the price");
  await Country.updateOne({ code: "UG" }, { $set: { messageCreditPrice: 999 } });
  const stored = await CreditTransaction.findOne({ user: buyer, type: "purchase" }).lean();
  assert(stored?.localAmount === 5000 && stored?.amount === 20, "a purchase keeps the money paid and credits bought");
  await Country.updateOne({ code: "UG" }, { $set: { messageCreditPrice: 250 } });

  console.log("Listener total spend");
  const optionB = await makeUser("0701234567", 2);
  await purchase(optionB, 2, 500);
  const asSuperAdmin: any = await UserService.getListenerById(optionB, "super_admin");
  const asPartner: any = await UserService.getListenerById(optionB, "partner_admin");
  assert(asSuperAdmin.totalSpend === 500, "UGX 500 for 2 credits shows UGX 500 to a Super Admin");
  assert(asPartner.totalSpend === 500, "UGX 500 for 2 credits shows UGX 500 to other roles");

  await purchase(optionB, 8, 2000);
  assert(((await UserService.getListenerById(optionB, "super_admin")) as any).totalSpend === 2500, "several purchases add up");

  const noPurchase = await makeUser("0751234567", 0);
  assert(((await UserService.getListenerById(noPurchase, "super_admin")) as any).totalSpend === 0, "no purchases shows 0");

  const noAmount = await makeUser("0741234567", 3);
  await purchase(noAmount, 3, undefined);
  assert(((await UserService.getListenerById(noAmount, "partner_admin")) as any).totalSpend === 0, "a credit count is never shown as money");

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
