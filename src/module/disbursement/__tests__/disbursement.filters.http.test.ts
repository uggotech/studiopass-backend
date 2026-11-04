/**
 * Disbursement list filters (GET /disbursement), added 2026-11-04: country, partner, station, prize type, date range,
 * always inside the caller's scope. Read-only list: no payout provider is called.
 * Real Express app, real JWT auth, throwaway MongoDB + Redis; no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" REDIS_URL="redis://127.0.0.1:6390" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/disbursement/__tests__/disbursement.filters.http.test.ts
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
import { Disbursement } from "../disbursement.model";

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
  const models = [User, Auth, Station, Disbursement];
  await Promise.all(models.map((m: any) => m.deleteMany({})));

  const server = http.createServer(app);
  const api: string = await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`)),
  );

  const oid = () => new mongoose.Types.ObjectId();
  const uganda = oid();
  const kenya = oid();
  const partnerA = oid();
  const partnerB = oid();
  const st = async (name: string, country: mongoose.Types.ObjectId, partner: mongoose.Types.ObjectId) =>
    (await Station.collection.insertOne({ name, stationCode: name, category: "channel", isActive: true, country, partner })).insertedId;
  const radioA = await st("UG-A", uganda, partnerA);
  const radioB = await st("UG-B", uganda, partnerB);
  const radioK = await st("KE-A", kenya, partnerA);

  const winner = oid();
  const challenge = oid();
  const day = (d: string) => new Date(`${d}T10:00:00.000Z`);
  const prize = (station: mongoose.Types.ObjectId, prizeTypeKey: string, createdAt: Date, status = "pending") => ({
    challenge, winnerUser: winner, winnerName: "Winner", phone: "+256700000009", station, prizeTypeKey,
    prizeLabel: prizeTypeKey, prizeValue: "1", status, createdAt, updatedAt: createdAt,
  });
  await Disbursement.collection.insertMany([
    prize(radioA, "airtime", day("2026-10-01")),
    prize(radioA, "tshirt", day("2026-10-15"), "successful"),
    prize(radioB, "airtime", day("2026-10-20")),
    prize(radioK, "airtime", day("2026-11-01")),
  ]);

  const makeUser = async (role: string, extra: Record<string, unknown> = {}) => {
    const authId = (await Auth.collection.insertOne({ status: "active", loginProvider: "username", role })).insertedId;
    const userId = (await User.collection.insertOne({ fullName: `T ${role}`, role, auth: authId, ...extra })).insertedId;
    return createJwtToken({ userId: String(userId) }, config.jwt.jwt_secret as string, "1h");
  };
  const superAdmin = await makeUser("super_admin");
  const partnerAdminA = await makeUser("partner_admin", { partnerId: partnerA });

  const list = async (token: string, q: Record<string, string> = {}) => {
    const r = await fetch(`${api}/disbursement?${new URLSearchParams(q)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await r.json()) as any;
    return { status: r.status, n: Array.isArray(body.data) ? body.data.length : -1, total: body.meta?.total };
  };

  console.log("Super admin");
  assert((await list(superAdmin)).n === 4, "no filter: all 4");
  assert((await list(superAdmin, { country: String(uganda) })).n === 3, "country Uganda: 3");
  assert((await list(superAdmin, { partner: String(partnerA) })).n === 3, "partner A: 3 (two countries)");
  assert((await list(superAdmin, { country: String(uganda), partner: String(partnerA) })).n === 2, "Uganda + partner A: 2");
  assert((await list(superAdmin, { station: String(radioB) })).n === 1, "one station: 1");
  assert((await list(superAdmin, { prizeType: "tshirt" })).n === 1, "prize type: 1");
  assert((await list(superAdmin, { from: "2026-10-10T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z" })).n === 2, "date range: 2");
  assert((await list(superAdmin, { prizeType: "airtime", status: "pending", country: String(uganda) })).n === 2, "filters combine: 2");
  assert((await list(superAdmin, { country: "not-an-id" })).n === 0, "malformed id: empty list, no error");
  assert((await list(superAdmin, { from: "yesterday-ish" })).status === 400, "bad date: 400");

  console.log("Partner admin stays inside its own partner");
  assert((await list(partnerAdminA)).n === 3, "partner admin A: its 3");
  assert((await list(partnerAdminA, { partner: String(partnerB) })).n === 3, "a partner filter cannot widen or switch the scope");
  assert((await list(partnerAdminA, { station: String(radioB) })).n === 0, "another partner's station: 0");
  assert((await list(partnerAdminA, { country: String(kenya) })).n === 1, "own stations in Kenya: 1");

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
