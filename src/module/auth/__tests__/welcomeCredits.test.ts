/**
 * Welcome credits: a brand-new app account gets WELCOME_CREDITS free Studio Credits once, recorded as a
 * free grant from the super admin. Existing accounts and repeat logins get nothing; 0 turns it off.
 * Real MongoDB (replica set, throwaway DB); the SMS gateway is switched off in `initiate`, no network.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/auth/__tests__/welcomeCredits.test.ts
 */
import mongoose from "mongoose";
import config from "../../../config";
import { AuthService } from "../auth.service";
import { User } from "../../user/user.model";
import { Auth } from "../auth.model";
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

async function login(phone: string) {
  await AuthService.initiate({ phone, countryCode: "+256", countryName: "Uganda" });
  return AuthService.verifyOtp({ phone, countryCode: "+256", countryName: "Uganda", otp: "1234" });
}

async function stateFor(phone: string) {
  const auth: any = await Auth.findOne({ phone: `+256${phone}` }).lean();
  const user: any = await User.findOne({ auth: auth._id }).lean();
  const bal: any = await CreditBalance.findOne({ user: user._id }).lean();
  const txs: any[] = await CreditTransaction.find({ user: user._id }).lean();
  return { user, bal, txs };
}

async function main() {
  await mongoose.connect(MONGO_URL as string);
  await mongoose.connection.dropDatabase();

  const adminAuth = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  await Auth.collection.insertOne({ _id: adminAuth, username: "root", loginProvider: "username", role: "super_admin", status: "active", isPhoneVerified: false });
  await User.collection.insertOne({ _id: adminId, auth: adminAuth, fullName: "Super Admin", role: "super_admin", isDeleted: false, createdAt: new Date() });

  console.log("\nTurned on (100 credits)");
  (config as any).welcomeCredits = 100;
  await login("700000201");
  const a = await stateFor("700000201");
  assert(a.bal?.balance === 100, "new account starts with 100 credits");
  assert(a.bal?.freeBalance === 100 && (a.bal?.paidBalance ?? 0) === 0, "they are free credits (not paid)");
  assert(a.txs.length === 1 && a.txs[0].type === "admin_grant" && a.txs[0].isFree === true, "one free admin_grant in the ledger");
  assert(String(a.txs[0].grantedBy) === String(adminId), "granted by the super admin");
  assert(a.txs[0].adminRole === "super_admin" && a.txs[0].adminName === "Super Admin", "ledger shows super admin as the giver");
  assert(a.txs[0].reason === "Welcome credits", "reason says Welcome credits");

  await login("700000201");
  const a2 = await stateFor("700000201");
  assert(a2.bal?.balance === 100 && a2.txs.length === 1, "logging in again gives nothing more");

  console.log("\nExisting account created while the feature was off");
  (config as any).welcomeCredits = 0;
  await login("700000202");
  (config as any).welcomeCredits = 100;
  await login("700000202");
  const b = await stateFor("700000202");
  assert(!b.bal || b.bal.balance === 0, "an account that already exists is not topped up later");

  console.log("\nTurned off (0)");
  (config as any).welcomeCredits = 0;
  await login("700000203");
  const c = await stateFor("700000203");
  assert(!c.bal || c.bal.balance === 0, "with 0 configured a new account gets nothing");
  assert(c.txs.length === 0, "and no ledger entry is written");

  console.log("\nNo super admin present");
  await User.deleteOne({ _id: adminId });
  let threw = false;
  try { await login("700000204"); } catch { threw = true; }
  const d = await stateFor("700000204");
  assert(!threw, "login still works without a super admin");
  assert(!d.bal || d.bal.balance === 0, "no credits are given (and nothing breaks)");

  console.log(`\n${passed}/${total} checks passed`);
  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
