/**
 * Real "Unread" for listeners (2026-11-07): the badge and the Unread tab count the station's REPLIES the listener
 * has not seen (newer than the last time they opened that chat), not their own messages waiting for an answer.
 *  - POST /message/threads/:stationId/read marks a chat read (server clock, never backwards)
 *  - GET  /message/threads gives unreadCount (+ waitingCount = the old meaning), filter=unread, search
 * Real Express app, real JWT auth, throwaway MongoDB + Redis; no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" REDIS_URL="redis://127.0.0.1:6390" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/message/__tests__/message.unread.http.test.ts
 */
// Read when the repository module loads, so it must be set before the app is imported (replies older than this never count)
process.env.UNREAD_TRACKING_SINCE = "2026-11-02T00:00:00.000Z";

import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import config from "../../../config";
import app from "../../../app";
import createJwtToken from "../../../jwt/createJwtToken";
import { User } from "../../user/user.model";
import { Auth } from "../../auth/auth.model";
import { Station } from "../../station/station.model";
import Message from "../message.model";
import { ThreadRead } from "../threadRead.model";

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
  const models: any[] = [User, Auth, Station, Message, ThreadRead];
  await Promise.all(models.map((m) => m.deleteMany({})));

  const server = http.createServer(app);
  const api: string = await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`)),
  );

  const oid = () => new mongoose.Types.ObjectId();
  const country = oid();
  const station = async (name: string) =>
    (await Station.collection.insertOne({ name, stationCode: name, category: "radio", isActive: true, country })).insertedId;
  const radioA = await station("Radio Alpha");
  const radioB = await station("Radio Beta");
  const radioC = await station("Radio Gamma");

  const makeListener = async (phone: string) => {
    const authId = (await Auth.collection.insertOne({ status: "active", loginProvider: "phone", role: "user" })).insertedId;
    const userId = (await User.collection.insertOne({ fullName: `L ${phone}`, role: "user", phone, auth: authId })).insertedId;
    return { userId, phone, token: createJwtToken({ userId: String(userId) }, config.jwt.jwt_secret as string, "1h") };
  };
  const me = await makeListener("+256700000201");
  const other = await makeListener("+256700000202");

  const now = Date.now();
  const at = (msAgo: number) => new Date(now - msAgo);
  const msg = (station: unknown, l: { userId: unknown; phone: string }, sender: "user" | "station", content: string, createdAt: Date, extra: Record<string, unknown> = {}) => ({
    station,
    senderType: sender,
    user: sender === "user" ? l.userId : undefined,
    msisdn: l.phone,
    content,
    status: "approved",
    isReplied: sender === "station",
    isRead: false,
    isDeleted: false,
    deletedForEveryone: false,
    creditsUsed: sender === "user" ? 1 : 0,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });

  await Message.collection.insertMany([
    // Alpha: I asked, the station replied twice recently and once long ago (before unread tracking started)
    msg(radioA, me, "user", "hello alpha", at(60 * 60000), { isReplied: true }),
    msg(radioA, me, "station", "old reply", new Date("2026-11-01T10:00:00.000Z")),
    msg(radioA, me, "station", "reply one", at(30 * 60000)),
    msg(radioA, me, "station", "reply that was deleted for everyone", at(29 * 60000), { deletedForEveryone: true }),
    msg(radioA, me, "station", "reply I deleted for myself", at(28 * 60000), { deletedFor: [me.userId] }),
    msg(radioA, me, "station", "reply two", at(20 * 60000)),
    // Beta: I asked and nobody answered yet (waiting, NOT unread)
    msg(radioB, me, "user", "anyone there beta?", at(10 * 60000), { isReplied: false }),
    // Gamma: another listener's chat only
    msg(radioC, other, "user", "hi gamma", at(5 * 60000)),
    msg(radioC, other, "station", "hello other", at(4 * 60000)),
  ]);

  const get = async (q: string, token = me.token) => {
    const r = await fetch(`${api}/message/threads${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await r.json()) as any;
    return { status: r.status, rows: (Array.isArray(body.data) ? body.data : []) as any[] };
  };
  const row = (rows: any[], name: string) => rows.find((x) => x.stationName === name);
  const post = async (path: string, token = me.token) => {
    const r = await fetch(`${api}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    return { status: r.status, body: (await r.json()) as any };
  };

  console.log("Before opening any chat");
  let r = await get("?limit=50");
  assert(r.status === 200 && r.rows.length === 2, "my list has 2 chats (Alpha, Beta), not the other listener's");
  assert(row(r.rows, "Radio Alpha")?.unreadCount === 2, "Alpha: 2 unread replies (old, deleted-for-everyone and deleted-for-me ones are not counted)");
  assert(row(r.rows, "Radio Beta")?.unreadCount === 0, "Beta: 0 unread (nothing from the station)");
  assert(row(r.rows, "Radio Beta")?.waitingCount === 1, "Beta: waitingCount 1 (my message still unanswered: the old meaning is kept as waitingCount)");
  assert(row(r.rows, "Radio Alpha")?.waitingCount === 0, "Alpha: waitingCount 0 (the station answered)");

  console.log("Unread filter and search");
  r = await get("?limit=50&filter=unread");
  assert(r.rows.length === 1 && r.rows[0].stationName === "Radio Alpha", "filter=unread: only Alpha (Beta is only waiting)");
  r = await get("?limit=50&search=beta");
  assert(r.rows.length === 1 && r.rows[0].stationName === "Radio Beta", "search matches the station name");
  r = await get("?limit=50&search=reply%20two");
  assert(r.rows.length === 1 && r.rows[0].stationName === "Radio Alpha", "search matches the last message");

  console.log("Opening a chat marks it read");
  let m = await post(`/message/threads/${radioA}/read`);
  assert(m.status === 200 && Boolean(m.body.data?.lastReadAt), "POST read: 200 with lastReadAt");
  r = await get("?limit=50");
  assert(row(r.rows, "Radio Alpha")?.unreadCount === 0, "Alpha: 0 unread after opening it");
  r = await get("?limit=50&filter=unread");
  assert(r.rows.length === 0, "filter=unread: empty now");
  const firstRead = (await ThreadRead.findOne({ user: me.userId, station: radioA }).lean())?.lastReadAt?.getTime() ?? 0;
  await post(`/message/threads/${radioA}/read`);
  const secondRead = (await ThreadRead.findOne({ user: me.userId, station: radioA }).lean())?.lastReadAt?.getTime() ?? 0;
  assert(secondRead >= firstRead && (await ThreadRead.countDocuments({ user: me.userId, station: radioA })) === 1, "opening again never moves it back and keeps one row");

  console.log("A new reply after that is unread again");
  await Message.collection.insertOne(msg(radioA, me, "station", "reply three", new Date(Date.now() + 1000)));
  r = await get("?limit=50");
  assert(row(r.rows, "Radio Alpha")?.unreadCount === 1, "Alpha: 1 unread (reply three)");
  r = await get("?limit=50&filter=unread");
  assert(r.rows.length === 1, "filter=unread: Alpha again");

  console.log("Other listener and bad input");
  const o = await get("?limit=50", other.token);
  assert(row(o.rows, "Radio Gamma")?.unreadCount === 1, "the other listener has their own unread (1 on Gamma)");
  m = await post(`/message/threads/${radioC}/read`);
  r = await get("?limit=50&filter=unread");
  assert(r.rows.length === 1, "my read marks do not touch other listeners' state (my list unchanged by marking Gamma)");
  m = await post(`/message/threads/${oid()}/read`);
  assert(m.status === 404, "unknown station: 404");
  m = await post(`/message/threads/not-an-id/read`);
  assert(m.status === 400, "malformed id: 400");

  await Promise.all(models.map((x) => x.deleteMany({})));
  server.close();
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
