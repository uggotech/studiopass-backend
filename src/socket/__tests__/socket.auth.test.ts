/**
 * Socket handshake errors carry a machine-readable code, and a user's live sockets are closed when their
 * session is revoked or the account is blocked.
 * Real MongoDB + Redis (throwaway) and a real socket.io server on a random local port.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      REDIS_URL="redis://127.0.0.1:6390" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/socket/__tests__/socket.auth.test.ts
 */
import http from "http";
import path from "path";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import config from "../../config";
import redisClient from "../../redis/redisClient";
import { initSocket, disconnectUserSockets } from "..";
import { User } from "../../module/user/user.model";

// The backend does not depend on socket.io-client; the dashboard (a client of this very server) does
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { io } = require(path.resolve(__dirname, "../../../../dashboard/node_modules/socket.io-client"));

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function attempt(url: string, token?: string): Promise<{ connected: boolean; code?: string; message?: string; socket: any }> {
  return new Promise((resolve) => {
    const socket = io(url, { auth: token ? { token } : {}, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve({ connected: true, socket }));
    socket.on("connect_error", (err: any) => {
      resolve({ connected: false, code: err?.data?.code, message: err?.message, socket });
      socket.close();
    });
  });
}

async function main() {
  await mongoose.connect(MONGO_URL as string);
  await redisClient.connect();
  await User.deleteMany({});

  const server = http.createServer();
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const secret = config.jwt.jwt_secret as string;

  const makeUser = async (extra: Record<string, unknown> = {}) =>
    String((await User.collection.insertOne({ fullName: "Socket Tester", phone: `2567${Math.floor(10000000 + Math.random() * 89999999)}`, role: "user", auth: new mongoose.Types.ObjectId(), isBlocked: false, isDeleted: false, ...extra })).insertedId);
  const sign = (payload: Record<string, unknown>, options: jwt.SignOptions = { expiresIn: "1h" }) => jwt.sign(payload, secret, options);

  console.log("Handshake errors carry a code");
  const noToken = await attempt(url);
  assert(!noToken.connected && noToken.code === "AUTH_REQUIRED", "no token -> AUTH_REQUIRED");

  const userId = await makeUser();
  const expired = await attempt(url, sign({ userId }, { expiresIn: -60 }));
  assert(!expired.connected && expired.code === "TOKEN_EXPIRED", "expired token -> TOKEN_EXPIRED");

  const garbage = await attempt(url, "garbage");
  assert(!garbage.connected && garbage.code === "INVALID_TOKEN", "garbage token -> INVALID_TOKEN");
  assert(garbage.message === "Invalid token", "the message text is unchanged, so older clients behave as before");

  const blockedId = await makeUser({ isBlocked: true });
  const blocked = await attempt(url, sign({ userId: blockedId }));
  assert(!blocked.connected && blocked.code === "ACCOUNT_BLOCKED", "blocked account -> ACCOUNT_BLOCKED");

  const revoked = await attempt(url, sign({ userId, sid: "no-such-session" }));
  assert(!revoked.connected && revoked.code === "SESSION_REVOKED", "unknown / revoked session -> SESSION_REVOKED");

  console.log("A valid token connects");
  await redisClient.set("session:active:sess-A", "1", 300);
  await redisClient.set("session:active:sess-B", "1", 300);
  const a = await attempt(url, sign({ userId, sid: "sess-A" }));
  assert(a.connected, "session A connects");

  console.log("Closing a user's sockets");
  const b = await attempt(url, sign({ userId, sid: "sess-B" }));
  assert(b.connected, "session B (same user, another device) connects");

  let aClosed = false;
  let bClosed = false;
  a.socket.on("disconnect", () => (aClosed = true));
  b.socket.on("disconnect", () => (bClosed = true));

  disconnectUserSockets(userId, "sess-A");
  await sleep(1200);
  assert(aClosed && !bClosed, "revoking session A closes only A's socket; B stays connected");

  disconnectUserSockets(userId);
  await sleep(1200);
  assert(bClosed, "without a session id every socket of the user is closed");

  const other = await makeUser();
  const c = await attempt(url, sign({ userId: other }));
  let cClosed = false;
  c.socket.on("disconnect", () => (cClosed = true));
  disconnectUserSockets(userId);
  await sleep(1200);
  assert(c.connected && !cClosed, "another user's socket is untouched");

  c.socket.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await User.deleteMany({});
  await redisClient.delete("session:active:sess-A");
  await redisClient.delete("session:active:sess-B");
  await redisClient.disconnect();
  await mongoose.disconnect();
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
