/**
 * BE-01: a refresh whose response was lost must be repeatable; the old token is retired only after the
 * new pair exists; blocked accounts cannot refresh.
 * Real MongoDB + Redis (throwaway); no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      REDIS_URL="redis://127.0.0.1:6390" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/auth/__tests__/auth.refresh.test.ts
 */
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import config from "../../../config";
import redisClient from "../../../redis/redisClient";
import { AuthService } from "../auth.service";
import { Auth } from "../auth.model";
import { User } from "../../user/user.model";

const MONGO_URL = process.env.PAYTEST_MONGO_URL;
if (!MONGO_URL || !/paytest/.test(MONGO_URL) || !process.env.REDIS_URL) {
  console.error("Set PAYTEST_MONGO_URL (database name containing 'paytest') and REDIS_URL to throwaway servers.");
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

async function expectRejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}

async function main() {
  await mongoose.connect(MONGO_URL as string);
  await redisClient.connect();
  await Promise.all([Auth, User].map((m: any) => m.deleteMany({})));

  const authId = (await Auth.collection.insertOne({ loginProvider: "phone", role: "user", status: "active", phone: "256771819679" })).insertedId;
  const userId = (await User.collection.insertOne({ fullName: "Refresh Tester", phone: "256771819679", role: "user", auth: authId, isBlocked: false, isDeleted: false })).insertedId;

  const sign = () =>
    jwt.sign({ authId: String(authId), type: "refresh", n: Math.random() }, config.jwt.jwt_refresh_secret as string, { expiresIn: "1h" });
  const t0 = sign();

  console.log("Normal rotation");
  const pair1: any = await AuthService.refresh(t0);
  assert(!!pair1.accessToken && !!pair1.refreshToken && pair1.refreshToken !== t0, "first refresh returns a new pair");

  console.log("Lost response: the same token is used again");
  const again: any = await AuthService.refresh(t0);
  assert(again.accessToken === pair1.accessToken && again.refreshToken === pair1.refreshToken, "second use of the old token returns the SAME pair (not an error)");
  const ttl = await redisClient.client.ttl(`refresh_grace:${t0}`);
  assert(ttl > 60 && ttl <= 180, `the recovery window is minutes, not seconds (ttl ${ttl}s)`);

  console.log("The new token works and the old one is retired");
  const pair2: any = await AuthService.refresh(pair1.refreshToken);
  assert(!!pair2.refreshToken && pair2.refreshToken !== pair1.refreshToken, "the new refresh token can be refreshed in turn");

  await redisClient.delete(`refresh_grace:${t0}`); // pretend the recovery window has passed
  const late: any = await expectRejection(() => AuthService.refresh(t0));
  assert(late?.statusCode === 401 && late?.code === "REFRESH_REVOKED", "after the window, the old token is rejected with code REFRESH_REVOKED");

  console.log("A failed refresh does not burn the token");
  await User.collection.updateOne({ _id: userId }, { $set: { isBlocked: true } });
  const blocked: any = await expectRejection(() => AuthService.refresh(pair2.refreshToken));
  assert(blocked?.statusCode === 401 && blocked?.code === "ACCOUNT_BLOCKED", "a blocked account is refused with code ACCOUNT_BLOCKED");
  assert((await redisClient.get(`revoked_token:${pair2.refreshToken}`)) === null, "the refused token was NOT marked revoked");
  await User.collection.updateOne({ _id: userId }, { $set: { isBlocked: false } });
  const afterUnblock: any = await AuthService.refresh(pair2.refreshToken);
  assert(!!afterUnblock.accessToken, "once unblocked, the same token still refreshes");

  console.log("Bad tokens");
  const garbage: any = await expectRejection(() => AuthService.refresh("not-a-token"));
  assert(garbage?.statusCode === 401 && garbage?.code === "REFRESH_INVALID", "garbage is rejected with code REFRESH_INVALID");

  await Promise.all([Auth, User].map((m: any) => m.deleteMany({})));
  await redisClient.disconnect();
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
