/**
 * Many listeners acting at the same moment must not fail with "Write conflict" (HTTP 500):
 *  - simultaneous votes on one poll / one channel poll (all touch the same poll counter)
 *  - one listener's simultaneous credit charges (all touch the same balance)
 * Before the fix of 2026-11-03, 38 of 40 simultaneous poll votes failed.
 * Real MongoDB replica set (throwaway DB); no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/shared/__tests__/concurrency.test.ts
 */
import mongoose from "mongoose";
import { PollService } from "../../module/poll/poll.service";
import { Poll } from "../../module/poll/poll.model";
import { PollVote } from "../../module/poll/pollVote.model";
import { ChannelPollService } from "../../module/channelPoll/channelPoll.service";
import { ChannelPoll, ChannelPollVote } from "../../module/channelPoll/channelPoll.model";
import { CreditService } from "../../module/credit/credit.service";
import { CreditBalance } from "../../module/creditBalance/creditBalance.model";
import { CreditTransaction } from "../../module/creditTransaction/creditTransaction.model";
import { User } from "../../module/user/user.model";
import { Station } from "../../module/station/station.model";
import { runTransaction } from "../runTransaction";

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

const VOTERS = 60;

async function main() {
  await mongoose.connect(MONGO_URL as string);
  const models: any[] = [Poll, PollVote, ChannelPoll, ChannelPollVote, CreditBalance, CreditTransaction, User, Station];
  await Promise.all(models.map((m) => m.deleteMany({})));

  const station = (await Station.collection.insertOne({ name: "Radio C", stationCode: "RADC", category: "channel", isActive: true })).insertedId;
  const creator = new mongoose.Types.ObjectId();
  const voters: string[] = [];
  for (let i = 0; i < VOTERS; i++) {
    const id = (await User.collection.insertOne({ fullName: `Voter ${i}`, phone: `25670${String(i).padStart(7, "0")}`, role: "user", auth: new mongoose.Types.ObjectId() })).insertedId;
    await CreditBalance.collection.insertOne({ user: id, balance: 10, paidBalance: 10, freeBalance: 0, createdAt: new Date(), updatedAt: new Date() });
    voters.push(String(id));
  }

  console.log(`${VOTERS} simultaneous votes on one poll`);
  const poll = await Poll.create({ station, question: "Q", options: [{ label: "A" }, { label: "B" }], status: "active", createdBy: creator });
  const pollResults = await Promise.allSettled(voters.map((u, i) => PollService.votePoll(String(poll._id), i % 2, u)));
  const pollOk = pollResults.filter((r) => r.status === "fulfilled").length;
  const pollAfter: any = await Poll.findById(poll._id).lean();
  assert(pollOk === VOTERS, `every vote is saved (${pollOk}/${VOTERS})`);
  assert(pollAfter.totalVotes === VOTERS && pollAfter.options[0].votes + pollAfter.options[1].votes === VOTERS, "counters match the votes");
  const again: any = await Promise.allSettled([PollService.votePoll(String(poll._id), 0, voters[0]!)]);
  assert(again[0].status === "rejected" && again[0].reason?.statusCode === 409, "a second vote of the same listener is 409");

  console.log(`${VOTERS} simultaneous paid votes on one channel poll`);
  const cpoll = await ChannelPoll.create({
    station, title: "T", categories: [{ name: "Best", nominees: [{ name: "X" }, { name: "Y" }] }],
    status: "active", billingMode: "credits", creditCost: 1,
    startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 3_600_000), createdBy: creator,
  });
  const cResults = await Promise.allSettled(voters.map((u, i) => ChannelPollService.votePoll(String(cpoll._id), 0, i % 2, u)));
  const cOk = cResults.filter((r) => r.status === "fulfilled").length;
  const cAfter: any = await ChannelPoll.findById(cpoll._id).lean();
  const cVotes = await ChannelPollVote.countDocuments({ poll: cpoll._id });
  const charged = await CreditTransaction.countDocuments({ resourceId: cpoll._id, type: "poll_deduction" });
  const cFail: any = cResults.find((r) => r.status === "rejected");
  if (cFail) console.error("    first failure:", cFail.reason?.message || cFail.reason);
  assert(cOk === VOTERS, `every paid vote is saved (${cOk}/${VOTERS})`);
  assert(cAfter.totalVotes === VOTERS && cVotes === VOTERS, "counter and vote records match");
  assert(charged === VOTERS, "exactly one charge per vote");
  const cAgain: any = await Promise.allSettled([ChannelPollService.votePoll(String(cpoll._id), 0, 1, voters[0]!)]);
  const balance0 = (await CreditBalance.findOne({ user: voters[0] }).lean())?.balance;
  assert(cAgain[0].status === "rejected" && cAgain[0].reason?.statusCode === 409 && balance0 === 9, "a second vote is 409 and not charged");

  console.log("One listener, 8 simultaneous charges");
  const spender = voters[1]!;
  const before = (await CreditBalance.findOne({ user: spender }).lean())?.balance as number;
  const spend = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      runTransaction((session) => CreditService.deductCredits(spender, 1, String(station), new mongoose.Types.ObjectId().toString(), "message", session)),
    ),
  );
  const spendOk = spend.filter((r) => r.status === "fulfilled").length;
  const after = (await CreditBalance.findOne({ user: spender }).lean())?.balance as number;
  const sFail: any = spend.find((r) => r.status === "rejected");
  if (sFail) console.error("    first failure:", sFail.reason?.message || sFail.reason);
  assert(spendOk === 8, `all 8 charges succeed (${spendOk}/8)`);
  assert(before - after === 8, "the balance went down by exactly 8");

  console.log("Running out of credit while charging in parallel");
  const poor = voters[2]!;
  await CreditBalance.updateOne({ user: poor }, { $set: { balance: 3, paidBalance: 3 } });
  const drain = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      runTransaction((session) => CreditService.deductCredits(poor, 1, String(station), new mongoose.Types.ObjectId().toString(), "message", session)),
    ),
  );
  const drained = drain.filter((r) => r.status === "fulfilled").length;
  const left = (await CreditBalance.findOne({ user: poor }).lean())?.balance;
  const insufficient = drain.filter((r: any) => r.status === "rejected" && r.reason?.statusCode === 400).length;
  assert(drained === 3 && left === 0, "only the 3 available credits are spent; never below zero");
  assert(insufficient === 3, "the other 3 get a clean 400 'insufficient credits', not a 500");

  await Promise.all(models.map((m) => m.deleteMany({})));
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
