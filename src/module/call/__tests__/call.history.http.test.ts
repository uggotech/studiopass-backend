/**
 * Listener call history (GET /call/history), 2026-11-05: optional stationId filter used by the chat timeline,
 * which shows a listener's calls with one station between the messages, each with its show name.
 * Real Express app, real JWT auth, throwaway MongoDB + Redis; no network, no Agora.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" REDIS_URL="redis://127.0.0.1:6390" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/call/__tests__/call.history.http.test.ts
 */
import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import config from "../../../config";
import app from "../../../app";
import createJwtToken from "../../../jwt/createJwtToken";
import { User } from "../../user/user.model";
import { Auth } from "../../auth/auth.model";
import { Station } from "../../station/station.model";
import { Show } from "../../show/show.model";
import Call from "../call.model";

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
  const models = [User, Auth, Station, Show, Call];
  await Promise.all(models.map((m: any) => m.deleteMany({})));

  const server = http.createServer(app);
  const api: string = await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`)),
  );

  const country = new mongoose.Types.ObjectId();
  const stationA = (await Station.collection.insertOne({ name: "Radio A", stationCode: "SA", category: "radio", isActive: true, country })).insertedId;
  const stationB = (await Station.collection.insertOne({ name: "Radio B", stationCode: "SB", category: "radio", isActive: true, country })).insertedId;
  const showA = (await Show.collection.insertOne({ name: "Morning Drive", station: stationA, startTime: "06:00", endTime: "10:00", days: ["monday"], isActive: true })).insertedId;

  const makeUser = async (phone: string) => {
    const authId = (await Auth.collection.insertOne({ status: "active", loginProvider: "phone", role: "user" })).insertedId;
    const userId = (await User.collection.insertOne({ fullName: `L ${phone}`, role: "user", phone, auth: authId })).insertedId;
    return { userId, token: createJwtToken({ userId: String(userId) }, config.jwt.jwt_secret as string, "1h") };
  };
  const me = await makeUser("+256700000101");
  const other = await makeUser("+256700000102");

  const call = (startedBy: unknown, station: unknown, status: string, minutesAgo: number, show?: unknown) => ({
    station, startedBy, show, agoraChannelId: `c_${Math.random().toString(36).slice(2)}`, country,
    startedAt: new Date(Date.now() - minutesAgo * 60000), status, creditsUsed: 1,
  });
  await Call.collection.insertMany([
    call(me.userId, stationA, "completed", 50, showA),
    call(me.userId, stationA, "cancelled", 20, showA),
    call(me.userId, stationB, "completed", 10),
    call(other.userId, stationA, "completed", 5, showA),
  ]);

  const get = async (q: string, token = me.token) => {
    const r = await fetch(`${api}/call/history${q}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, body: (await r.json()) as any };
  };

  console.log("Call history");
  let r = await get("");
  assert(r.status === 200 && r.body.data.length === 3, "without a station: all 3 of my calls");
  r = await get(`?stationId=${stationA}`);
  assert(r.status === 200 && r.body.data.length === 2 && r.body.meta.total === 2, "station A: only my 2 calls there");
  assert(r.body.data.every((c: any) => String(c.station?._id ?? c.station) === String(stationA)), "...all with station A");
  assert(r.body.data[0].show?.name === "Morning Drive", "...each with its show name");
  assert(r.body.data[0].status === "cancelled", "...newest first");
  r = await get(`?stationId=${stationB}`);
  assert(r.status === 200 && r.body.data.length === 1, "station B: my 1 call");
  r = await get(`?stationId=not-an-id`);
  assert(r.status === 400, "malformed station id: 400");
  r = await get(`?stationId=${stationA}`, other.token);
  assert(r.status === 200 && r.body.data.length === 1, "another listener sees only their own call");

  await Promise.all(models.map((m: any) => m.deleteMany({})));
  server.close();
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
