/**
 * BE-03: a long conversation must be readable from the newest end, and the page numbers must add up.
 * Real MongoDB (replica set, throwaway DB); no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/message/__tests__/message.thread.test.ts
 */
import mongoose from "mongoose";
import { MessageService } from "../message.service";
import Message from "../message.model";
import { Station } from "../../station/station.model";
import { Country } from "../../country/country.model";

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
  await Promise.all([Message, Station, Country].map((m: any) => m.deleteMany({})));

  const country = (
    await Country.collection.insertOne({ name: "Uganda", code: "UG", timezone: "Africa/Kampala", currency: "UGX", messageCreditPrice: 500, callCreditPrice: 500 })
  ).insertedId;
  const station = String(
    (await Station.collection.insertOne({ name: "Thread Test", category: "channel", channelType: "message_chat", isActive: true, country })).insertedId,
  );
  const stationId = new mongoose.Types.ObjectId(station);
  const msisdn = "256771819679";
  const viewer = new mongoose.Types.ObjectId();

  // 120 messages, one per minute, "m001" (oldest) ... "m120" (newest)
  const start = Date.now() - 200 * 60_000;
  const docs = Array.from({ length: 120 }, (_, i) => ({
    station: stationId,
    msisdn,
    senderType: "user",
    content: `m${String(i + 1).padStart(3, "0")}`,
    mediaType: "text",
    status: "delivered",
    createdAt: new Date(start + i * 60_000),
    updatedAt: new Date(start + i * 60_000),
  }));
  await Message.collection.insertMany(docs as any[]);

  const thread = (page: number, limit: number, order?: "asc" | "desc", viewerId?: string): Promise<any> =>
    MessageService.getUserThread(station, msisdn, page, limit, viewerId, undefined, order);

  console.log("Default order (dashboard, old apps) is unchanged");
  const asc = await thread(1, 50);
  assert(asc.messages[0].content === "m001" && asc.messages[49].content === "m050", "default page 1 is still the oldest 50");
  assert(asc.meta.order === "asc", "meta says asc");

  console.log("order=desc returns the newest page");
  const d1 = await thread(1, 50, "desc");
  assert(d1.messages.length === 50, "page 1 has 50 messages");
  assert(d1.messages[0].content === "m071" && d1.messages[49].content === "m120", "page 1 is m071..m120 (the newest 50)");
  const times = d1.messages.map((m: any) => new Date(m.timestamp ?? m.createdAt).getTime());
  assert(times.every((t: number, i: number) => i === 0 || t >= times[i - 1]), "messages inside the page are oldest-first, ready to render");

  console.log("Older pages follow without gaps or repeats");
  const d2 = await thread(2, 50, "desc");
  const d3 = await thread(3, 50, "desc");
  assert(d2.messages[0].content === "m021" && d2.messages[49].content === "m070", "page 2 is m021..m070");
  assert(d3.messages.length === 20 && d3.messages[0].content === "m001" && d3.messages[19].content === "m020", "page 3 is the remaining m001..m020");
  const all = [...d3.messages, ...d2.messages, ...d1.messages].map((m: any) => m.content);
  assert(new Set(all).size === 120, "no message appears twice across the three pages");
  assert(d1.meta.total === 120 && d1.meta.totalPage === 3, "total and totalPage are right");

  console.log("Deleted messages are not counted");
  await Message.updateMany({ content: { $in: ["m118", "m119", "m120"] } }, { $set: { isDeleted: true } });
  const afterDelete = await thread(1, 50, "desc");
  assert(afterDelete.meta.total === 117, "total drops by the 3 soft-deleted messages");
  assert(afterDelete.messages[49].content === "m117", "newest visible message is now m117");

  console.log("Messages a listener deleted for themselves are not counted for them");
  await Message.updateMany({ content: "m100" }, { $set: { deletedFor: [viewer] } });
  const mine = await thread(1, 200, "desc", String(viewer));
  const other = await thread(1, 200, "desc", String(new mongoose.Types.ObjectId()));
  assert(mine.meta.total === 116 && !mine.messages.some((m: any) => m.content === "m100"), "the deleting listener sees 116 and not m100");
  assert(other.meta.total === 117 && other.messages.some((m: any) => m.content === "m100"), "another viewer still sees m100");

  await Promise.all([Message, Station, Country].map((m: any) => m.deleteMany({})));
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
