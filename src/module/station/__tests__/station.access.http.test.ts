/**
 * Who may read a station (GET /station/:id), found by the 2026-11-04 dashboard role test:
 *  - a Media Station / Presenter must read THEIR OWN station (the "create poll" form needs it), nobody else's
 *  - a listener gets the station without the station admin's e-mail and phone
 * Real Express app, real JWT auth, throwaway MongoDB + Redis; no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" REDIS_URL="redis://127.0.0.1:6390" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/station/__tests__/station.access.http.test.ts
 */
import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import config from "../../../config";
import app from "../../../app";
import createJwtToken from "../../../jwt/createJwtToken";
import { User } from "../../user/user.model";
import { Auth } from "../../auth/auth.model";
import { Station } from "../station.model";

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
  await Promise.all([User, Auth, Station].map((m: any) => m.deleteMany({})));

  const server = http.createServer(app);
  const api: string = await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`)),
  );

  const stationA = (await Station.collection.insertOne({ name: "Radio A", stationCode: "SA", category: "radio", isActive: true })).insertedId;
  const stationB = (await Station.collection.insertOne({ name: "Radio B", stationCode: "SB", category: "radio", isActive: true })).insertedId;

  const makeUser = async (role: string, extra: Record<string, unknown> = {}) => {
    const authId = (await Auth.collection.insertOne({ status: "active", loginProvider: "username", role })).insertedId;
    const userId = (await User.collection.insertOne({ fullName: `T ${role}`, role, auth: authId, ...extra })).insertedId;
    return { userId, token: createJwtToken({ userId: String(userId) }, config.jwt.jwt_secret as string, "1h") };
  };
  await makeUser("station_admin", { stationId: stationA, email: "admin@radio-a.test", phone: "+256700000001", fullName: "Admin A" });
  const media = await makeUser("media_station", { stationId: stationA });
  const presenter = await makeUser("presenter", { stationId: stationA });
  const listener = await makeUser("user");
  const nobody = await makeUser("media_station"); // no station assigned
  const superAdmin = await makeUser("super_admin");

  const get = async (id: unknown, token?: string) => {
    const r = await fetch(`${api}/station/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: r.status, body: (await r.json()) as any };
  };

  console.log("Media station / presenter: own station only");
  let r = await get(stationA, media.token);
  assert(r.status === 200 && r.body.data.name === "Radio A", "media station reads its own station");
  r = await get(stationA, presenter.token);
  assert(r.status === 200, "presenter reads its own station");
  r = await get(stationB, media.token);
  assert(r.status === 403, "media station cannot read another station (403)");
  r = await get(stationB, presenter.token);
  assert(r.status === 403, "presenter cannot read another station (403)");
  r = await get(stationA, nobody.token);
  assert(r.status === 403, "a media station without an assigned station gets 403");
  r = await get(stationA);
  assert(r.status === 401, "no token -> 401");

  console.log("Station admin contact details");
  r = await get(stationA, superAdmin.token);
  assert(r.status === 200 && r.body.data.adminUser?.email === "admin@radio-a.test", "staff still get the station admin's contact details");
  r = await get(stationA, listener.token);
  assert(r.status === 200 && r.body.data.name === "Radio A", "a listener still gets the station");
  assert(r.body.data.adminUser === undefined && !JSON.stringify(r.body).includes("admin@radio-a.test") && !JSON.stringify(r.body).includes("+256700000001"), "...without the station admin's e-mail or phone");

  await Promise.all([User, Auth, Station].map((m: any) => m.deleteMany({})));
  server.close();
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
