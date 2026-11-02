/**
 * HTTP-level test of the Super Admin payment endpoints (credit packages, payout limits)
 * and the manual "mark as paid" endpoint: real Express app, real JWT auth, throwaway MongoDB.
 * No provider is contacted.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/payment/__tests__/payment.admin.http.test.ts
 */
import http from "http";
import { AddressInfo } from "net";
import mongoose from "mongoose";
import config from "../../../config";
import app from "../../../app";
import createJwtToken from "../../../jwt/createJwtToken";
import { User } from "../../user/user.model";
import { Auth } from "../../auth/auth.model";
import { CreditPackage } from "../payment.package.model";
import { Disbursement } from "../../disbursement/disbursement.model";
import { invalidatePayoutLimitsCache } from "../payout.settings";

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
  await Promise.all([User.init(), Auth.init(), CreditPackage.init(), Disbursement.init()]);
  await Promise.all([User, Auth, CreditPackage, Disbursement].map((m: any) => m.deleteMany({})));
  invalidatePayoutLimitsCache();

  const server = http.createServer(app);
  const api: string = await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`)),
  );

  const makeUser = async (role: string, extra: Record<string, unknown> = {}) => {
    const authId = (await Auth.collection.insertOne({ status: "active", loginProvider: "username", role })).insertedId;
    const userId = (await User.collection.insertOne({ fullName: `T ${role}`, role, auth: authId, ...extra })).insertedId;
    return createJwtToken({ userId: String(userId) }, config.jwt.jwt_secret as string, "1h");
  };
  const superToken = await makeUser("super_admin");
  const stationToken = await makeUser("station_admin");
  const listenerToken = await makeUser("user");

  const call = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${api}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (r: Response) => (await r.json()) as any;

  console.log("Who may manage packages and limits");
  for (const [method, path, body] of [
    ["GET", "/payment/admin/packages"],
    ["POST", "/payment/admin/packages", { label: "A", amountUgx: 500, credits: 1 }],
    ["GET", "/payment/admin/payout-limits"],
    ["PATCH", "/payment/admin/payout-limits", { dailyLimitUgx: 600000 }],
  ] as const) {
    assert((await call(method, path, undefined, body)).status === 401, `${method} ${path}: no token -> 401`);
    assert((await call(method, path, listenerToken, body)).status === 403, `${method} ${path}: listener -> 403`);
    assert((await call(method, path, stationToken, body)).status === 403, `${method} ${path}: station admin -> 403`);
  }
  assert((await CreditPackage.countDocuments({})) === 0, "refused requests created nothing");

  console.log("Super Admin: credit packages");
  let r = await call("GET", "/payment/admin/packages", superToken);
  assert(r.status === 200 && (await json(r)).data.length === 0, "/admin/packages reaches the admin list (not swallowed by /:transactionId)");

  r = await call("POST", "/payment/admin/packages", superToken, { label: "Starter", amountUgx: 500, credits: 2 });
  const created = (await json(r)).data;
  assert(r.status === 201 && created.id && created.amountUgx === 500 && created.credits === 2 && created.isActive === true, "create package (201), active by default");

  for (const [body, why] of [
    [{ label: "x", amountUgx: 50, credits: 1 }, "price too low"],
    [{ label: "x", amountUgx: 500.5, credits: 1 }, "fractional price"],
    [{ label: "x", amountUgx: 500 }, "missing credits"],
    [{ label: "", amountUgx: 500, credits: 1 }, "empty name"],
    [{ label: "x", amountUgx: "500", credits: 1 }, "price as text"],
  ] as const) {
    r = await call("POST", "/payment/admin/packages", superToken, body);
    assert(r.status >= 400 && r.status < 500, `rejects ${why} (${r.status})`);
  }
  assert((await CreditPackage.countDocuments({})) === 1, "invalid packages are not saved");

  r = await call("PATCH", `/payment/admin/packages/${created.id}`, superToken, { amountUgx: 1000, credits: 4 });
  assert(r.status === 200 && (await json(r)).data.amountUgx === 1000, "edit package");
  r = await call("PATCH", `/payment/admin/packages/${created.id}`, superToken, {});
  assert(r.status >= 400 && r.status < 500, "empty edit is rejected");
  r = await call("PATCH", `/payment/admin/packages/not-an-id`, superToken, { label: "Z" });
  assert(r.status === 404, "unknown package id -> 404");

  console.log("Listener view of packages");
  await call("POST", "/payment/admin/packages", superToken, { label: "Hidden", amountUgx: 2000, credits: 8, isActive: false });
  r = await call("GET", "/payment/packages", listenerToken);
  const visible = (await json(r)).data as any[];
  assert(r.status === 200 && visible.length === 1 && visible[0].id === created.id && !("isActive" in visible[0]), "listener sees only active packages, no admin fields");
  r = await call("GET", "/payment/admin/packages", superToken);
  assert((await json(r)).data.length === 2, "Super Admin still sees the inactive package");

  console.log("Super Admin: payout limits");
  r = await call("GET", "/payment/admin/payout-limits", superToken);
  let limits = (await json(r)).data;
  assert(r.status === 200 && limits.maxPerWinnerUgx === 200000 && limits.dailyLimitUgx === 500000, "defaults: 200,000 per winner, 500,000 per day");
  r = await call("PATCH", "/payment/admin/payout-limits", superToken, { dailyLimitUgx: 600000 });
  limits = (await json(r)).data;
  assert(r.status === 200 && limits.dailyLimitUgx === 600000 && limits.maxPerWinnerUgx === 200000, "change the daily limit");
  for (const [body, why] of [
    [{}, "empty body"],
    [{ maxPerWinnerUgx: 0 }, "zero cap"],
    [{ dailyLimitUgx: -5 }, "negative limit"],
    [{ dailyLimitUgx: 1000 }, "daily limit below the per-winner cap"],
    [{ maxPerWinnerUgx: "lots" }, "text instead of number"],
  ] as const) {
    r = await call("PATCH", "/payment/admin/payout-limits", superToken, body);
    assert(r.status >= 400 && r.status < 500, `rejects ${why} (${r.status})`);
  }
  r = await call("GET", "/payment/admin/payout-limits", superToken);
  assert((await json(r)).data.dailyLimitUgx === 600000, "rejected changes leave the limits as they were");

  console.log("Manual 'mark as paid' endpoint");
  const station = new mongoose.Types.ObjectId();
  const winner = (await User.collection.insertOne({ fullName: "Winner", phone: "0771819679" })).insertedId;
  const row = await Disbursement.create({
    challenge: new mongoose.Types.ObjectId(), winnerUser: winner, winnerName: "Winner", phone: "0771819679", station,
    prizeTypeKey: "mobile_money", prizeLabel: "Cash", prizeValue: "UGX 5000", txRef: "PRZ-http-1", provider: "mobile_money", status: "pending",
  });
  const path = `/disbursement/${row._id}/mark-paid`;
  assert((await call("POST", path, undefined, { reference: "MTN-1234" })).status === 401, "no token -> 401");
  assert((await call("POST", path, listenerToken, { reference: "MTN-1234" })).status === 403, "listener -> 403");
  assert((await call("POST", path, stationToken, { reference: "MTN-1234" })).status === 403, "station admin -> 403");
  assert((await call("POST", path, superToken, {})).status >= 400, "reference is required");
  assert((await call("POST", path, superToken, { reference: "ab" })).status >= 400, "too-short reference is rejected");
  assert((await Disbursement.findById(row._id).lean())?.status === "pending", "refused requests leave the prize pending");

  r = await call("POST", path, superToken, { reference: "MTN-1234", note: "Paid from MTN wallet" });
  const done = (await json(r)).data;
  assert(r.status === 200 && done.status === "successful" && done.provider === "manual" && done.providerReference === "MTN-1234", "Super Admin marks the prize paid");
  assert((await call("POST", path, superToken, { reference: "MTN-5678" })).status === 409, "second attempt -> 409");
  assert((await call("POST", `/disbursement/${new mongoose.Types.ObjectId()}/mark-paid`, superToken, { reference: "MTN-1234" })).status === 404, "unknown prize -> 404");

  await mongoose.connection.db!.dropDatabase();
  server.close();
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
