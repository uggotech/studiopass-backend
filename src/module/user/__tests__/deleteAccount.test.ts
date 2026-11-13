/**
 * Listener self-service account deletion: personal data is erased at once, records we must keep
 * stay but anonymous, and the phone number can register again as a new account.
 * Real MongoDB (replica set, throwaway DB); no network, no SMS, no payment provider.
 *
 * Run: PAYTEST_MONGO_URL="mongodb://127.0.0.1:27020/studiopass_paytest?directConnection=true" \
 *      npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/user/__tests__/deleteAccount.test.ts
 */
import mongoose from "mongoose";
import { UserService } from "../user.service";
import { User } from "../user.model";
import { Auth } from "../../auth/auth.model";
import { AuthRepository } from "../../auth/auth.repository";
import Message from "../../message/message.model";
import { Follow } from "../../follow/follow.model";
import { Notification } from "../../notification/notification.model";
import { OTP } from "../../otp/otp.model";
import { PaymentTransaction } from "../../payment/payment.model";
import { Disbursement } from "../../disbursement/disbursement.model";
import { AuditLog } from "../../auditLog/auditLog.model";

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

const PHONE = "+256700000999";

async function main() {
  await mongoose.connect(MONGO_URL as string);
  await mongoose.connection.dropDatabase();

  const oid = () => new mongoose.Types.ObjectId();
  const stationId = oid();

  // ── Fixtures (raw inserts, so unrelated required fields do not matter) ──
  const authId = oid();
  const userId = oid();
  await Auth.collection.insertOne({
    _id: authId, phone: PHONE, countryCode: "+256", isPhoneVerified: true,
    loginProvider: "phone", role: "user", status: "active", createdAt: new Date(), updatedAt: new Date(),
  });
  await User.collection.insertOne({
    _id: userId, auth: authId, fullName: "Real Name", avatar: "studiopass/real.webp", email: "a@b.co",
    phone: PHONE, phoneCountryCode: "+256", fcmToken: "tok-123", role: "user", profileCompleted: true,
    isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
  });
  await Message.collection.insertMany([
    { _id: oid(), user: userId, msisdn: PHONE, station: stationId, senderType: "user", content: "hello" },
    { _id: oid(), msisdn: PHONE, station: stationId, senderType: "station", content: "reply" },
  ]);
  await Follow.collection.insertOne({ _id: oid(), user: userId, station: stationId });
  await Notification.collection.insertOne({ _id: oid(), user: userId, title: "t" });
  await OTP.collection.insertOne({ _id: oid(), userId: authId, otp: "1234", target: PHONE, type: "account_verification" });
  await PaymentTransaction.collection.insertMany([
    { _id: oid(), user: userId, phoneNumber: "256700000999", status: "completed", transactionId: "tx-done" },
    { _id: oid(), user: userId, phoneNumber: "256700000999", status: "pending", transactionId: "tx-pending" },
  ]);
  await Disbursement.collection.insertMany([
    { _id: oid(), challenge: oid(), winnerUser: userId, winnerName: "Real Name", phone: "256700000999", status: "successful" },
    { _id: oid(), challenge: oid(), winnerUser: userId, winnerName: "Real Name", phone: "256700000999", status: "pending" },
  ]);

  // A second, untouched user (must not be affected)
  const otherAuth = oid();
  const otherUser = oid();
  await Auth.collection.insertOne({ _id: otherAuth, phone: "+256700000111", isPhoneVerified: true, loginProvider: "phone", role: "user", status: "active" });
  await User.collection.insertOne({ _id: otherUser, auth: otherAuth, fullName: "Other", phone: "+256700000111", role: "user", isDeleted: false });
  await Follow.collection.insertOne({ _id: oid(), user: otherUser, station: stationId });

  // A staff user must not be deletable here
  const staffAuth = oid();
  const staffUser = oid();
  await Auth.collection.insertOne({ _id: staffAuth, username: "staff1", loginProvider: "username", role: "station_admin", status: "active", isPhoneVerified: false });
  await User.collection.insertOne({ _id: staffUser, auth: staffAuth, fullName: "Staff", role: "station_admin", isDeleted: false });

  console.log("\nDelete a listener account");
  const result = await UserService.deleteMyAccount(userId.toString(), { ip: "127.0.0.1", userAgent: "test" });
  assert(result.deleted === true, "returns deleted: true");

  const auth = await Auth.findById(authId).lean<any>();
  assert(auth?.status === "inactive", "auth is locked (inactive)");
  assert(auth?.isPhoneVerified === false, "phone is no longer verified");
  assert(auth?.phone === `deleted-${authId}`, "phone number is replaced by an anonymous marker");

  const user = await User.findById(userId).lean<any>();
  assert(user?.isDeleted === true, "user is flagged deleted");
  assert(user?.fullName === "Deleted user", "name is anonymised");
  assert(!user?.avatar && !user?.email && !user?.phone && !user?.phoneCountryCode, "photo, e-mail and phone are erased");
  assert(!user?.fcmToken, "push token is erased");
  assert(user?.profileCompleted === false, "profile no longer complete");

  const msgs = await Message.find({ station: stationId }).lean<any[]>();
  assert(msgs.length === 2 && msgs.every((m) => m.msisdn === `deleted-${authId}`), "messages keep their text but lose the phone number");
  assert((await Follow.countDocuments({ user: userId })) === 0, "follows are removed");
  assert((await Notification.countDocuments({ user: userId })) === 0, "notifications are removed");
  assert((await OTP.countDocuments({ userId: authId })) === 0, "sign-in codes are removed");

  const pay = await PaymentTransaction.find({ user: userId }).lean<any[]>();
  const payDone = pay.find((p) => p.status === "completed");
  const payPending = pay.find((p) => p.status === "pending");
  assert(payDone?.phoneNumber === "***999", "finished payment keeps only the last 3 digits");
  assert(payPending?.phoneNumber === "256700000999", "pending payment is left untouched (still being settled)");

  const dis = await Disbursement.find({ winnerUser: userId }).lean<any[]>();
  const disDone = dis.find((d) => d.status === "successful");
  const disPending = dis.find((d) => d.status === "pending");
  assert(disDone?.winnerName === "Deleted user" && disDone?.phone === "***999", "finished payout is anonymised");
  assert(disPending?.winnerName === "Real Name", "pending payout is left untouched");

  const audit = await AuditLog.findOne({ action: "ACCOUNT_DELETED" }).lean<any>();
  assert(!!audit && audit.status === "SUCCESS", "an audit entry is written");
  assert(!audit?.usernameOrPhone, "audit entry holds no phone number");

  // Others untouched
  assert((await User.findById(otherUser).lean<any>())?.fullName === "Other", "other users are not touched");
  assert((await Follow.countDocuments({ user: otherUser })) === 1, "other users' follows are not touched");

  console.log("\nGuards and re-registration");
  let secondErr: any = null;
  try { await UserService.deleteMyAccount(userId.toString()); } catch (e) { secondErr = e; }
  assert(secondErr?.statusCode === 404, "deleting twice is rejected (404)");

  let staffErr: any = null;
  try { await UserService.deleteMyAccount(staffUser.toString()); } catch (e) { staffErr = e; }
  assert(staffErr?.statusCode === 403, "staff accounts cannot be deleted from the app (403)");
  assert((await User.findById(staffUser).lean<any>())?.isDeleted === false, "staff account stays intact");

  assert((await AuthRepository.findByPhone(PHONE)) == null, "the old phone number no longer finds an account");
  // The same number can register again: a new verified auth with that phone must not collide
  let reRegisterOk = true;
  try {
    await Auth.collection.insertOne({ _id: oid(), phone: PHONE, countryCode: "+256", isPhoneVerified: true, loginProvider: "phone", role: "user", status: "active" });
  } catch { reRegisterOk = false; }
  assert(reRegisterOk, "the same phone number can register again as a new account");

  console.log(`\n${passed}/${total} checks passed`);
  await mongoose.disconnect();
  process.exit(passed === total ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
