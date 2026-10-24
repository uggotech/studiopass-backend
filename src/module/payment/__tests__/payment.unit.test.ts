/**
 * Payment unit tests (no DB / network).
 * Run: npx ts-node-dev --transpile-only src/module/payment/__tests__/payment.unit.test.ts
 */
import config from "../../../config";
import {
  generatePayLeoSignature,
  generatePayLeoTransactionId,
  isPayLeoPushRejected,
  parsePayLeoXmlCallback,
  fromForwardedPayLeoCallback,
  verifyPayLeoForwardSignature,
  buildPayLeoXmlResponse,
} from "../payleo.service";
import {
  generateAirtelId,
  classifyAirtelDisbursement,
  encryptAirtelPin,
  parseAirtelKeyExpiry,
} from "../airtel.service";
import { stripHashMember, verifyAirtelCallbackHash } from "../airtel.signature";
import { getCreditPackages, findCreditPackage } from "../payment.packages";
import { normalizeUgandaPhone } from "../../../shared/telecom/ugandaPhone.util";

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

console.log("PayLeo signature");
// Reference: printf '%s' "<data>" | openssl dgst -sha256 -hmac 'test-secret'
assert(
  generatePayLeoSignature("256771819679", 500, "123456789012345", "StudioPass 1 Credits", {
    signatureUrl: "https://vendors.pay-leo.com/api/v2/live/deposit",
    merchantCode: "38280",
    consumerSecret: "test-secret",
  }) === "bad95526b292d78ce42418ec1930dfef330dff156d86a495706cbff51d296e25",
  "HMAC matches PHP hash_hmac/openssl reference",
);

console.log("PayLeo transaction id");
const ids = Array.from({ length: 200 }, () => generatePayLeoTransactionId());
assert(ids.every((id) => /^\d{15}$/.test(id)), "always 15 numeric digits");
assert(new Set(ids).size === ids.length, "200 ids are unique");

console.log("PayLeo push response");
assert(isPayLeoPushRejected({ status: "FAILED", code: 204, message: "x" }), "FAILED/204 body is a rejection");
assert(!isPayLeoPushRejected({ status: "OK", code: 100, message: "Transaction is being Processed" }), "OK/100 is accepted");
assert(!isPayLeoPushRejected({ raw: "accepted" }), "unknown shape is not treated as rejection");

console.log("PayLeo XML callback");
const sample = `<?xml version="1.0" encoding="UTF-8"?><request>
<method>receivePayment</method>
<msisdn>256772123456</msisdn>
<transactionId>039293292142323</transactionId>
<referenceId>32432432423423222</referenceId>
<amount>500</amount>
</request>`;
const parsed = parsePayLeoXmlCallback(sample);
assert(parsed?.method === "receivePayment", "method parsed");
assert(parsed?.transactionId === "039293292142323", "transactionId kept as string (leading zero preserved)");
assert(parsed?.referenceId === "32432432423423222", "17-digit referenceId not rounded");
assert(parsed?.amount === "500", "amount parsed");
assert(
  parsePayLeoXmlCallback(`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><request><method>&x;</method></request>`) === null,
  "DOCTYPE/ENTITY payload rejected",
);
assert(parsePayLeoXmlCallback("not xml") === null, "non-XML rejected");
assert(
  buildPayLeoXmlResponse(200, "Transaction received") ===
    `<?xml version="1.0" encoding="UTF-8"?>\n<request><code>200</code><message>Transaction received</message></request>`,
  "acknowledgment matches True African format",
);

console.log("PayLeo forwarder");
(config.payleo as any).forward_secret = "fwd-secret";
const fwdBody = `{"status":"SUCCESS","transactionId":"123"}`;
// Reference: printf '%s' "<body>" | openssl dgst -sha256 -hmac 'fwd-secret'
const fwdSig = "ee9983e5fd353cffdb5b60269deadb3389cf544371d5a851548e7ac25fc8b1ac";
assert(verifyPayLeoForwardSignature(fwdBody, fwdSig), "valid X-StudioPass-Signature accepted");
assert(!verifyPayLeoForwardSignature(fwdBody + " ", fwdSig), "tampered body rejected");
assert(!verifyPayLeoForwardSignature(fwdBody, undefined), "missing signature rejected");
(config.payleo as any).forward_secret = "";
assert(!verifyPayLeoForwardSignature(fwdBody, fwdSig), "rejected when no secret configured");
const mapped = fromForwardedPayLeoCallback({
  status: "SUCCESS",
  method: "receivePayment",
  msisdn: "256771819679",
  transactionId: "123",
  amount: "500",
});
assert(mapped?.method === "receivePayment" && mapped.transactionId === "123", "forwarded JSON mapped to callback shape");

console.log("Airtel ids");
const airtelId = generateAirtelId("TXN");
assert(/^TXN\d{10}[0-9A-F]{6}$/.test(airtelId) && airtelId.length === 19, "TXN id matches client's 19-char format");

console.log("Airtel callback hash");
const AIRTEL_KEY = "test-hash-key";
// Reference: printf '%s' "<json>" | openssl dgst -sha256 -hmac 'test-hash-key' -binary | openssl base64
const signedJson = `{"transaction":{"status_code":"TS","code":"DP00800001001","airtel_money_id":"147578349784","id":"TXN1779114705A2A8","message":"PAID.TID 147578349784. UGX 2,000 to FARMORA INNOVATIONS SMC LIMITED Charge UGX 120."}`;
const signedHash = "bxCSplfHVO4iifR5Qz6dwks7fhF0m9ABSdmyTHa2c8I=";
const signedRaw = `${signedJson},"hash":"${signedHash}"}`;
assert(stripHashMember(signedRaw) === `${signedJson}}`, "hash member cut out byte-exact (extra `code` field kept)");
let chk = verifyAirtelCallbackHash(signedRaw, JSON.parse(signedRaw), AIRTEL_KEY);
assert(chk.valid && chk.scheme === "raw-without-hash", "valid signature accepted (raw body scheme)");
chk = verifyAirtelCallbackHash(undefined, JSON.parse(signedRaw), AIRTEL_KEY);
assert(chk.valid && chk.scheme === "compact-transaction", "valid signature accepted without raw body (rebuilt transaction)");
chk = verifyAirtelCallbackHash(signedRaw.replace("147578349784", "999"), JSON.parse(signedRaw.replace("147578349784", "999")), AIRTEL_KEY);
assert(chk.present && !chk.valid, "tampered body rejected");
assert(!verifyAirtelCallbackHash(signedRaw, JSON.parse(signedRaw), "wrong-key").valid, "wrong key rejected");
chk = verifyAirtelCallbackHash(signedJson + "}", JSON.parse(signedJson + "}"), AIRTEL_KEY);
assert(!chk.present && !chk.valid, "missing hash reported as missing");
const hashFirst = `{"hash":"${signedHash}",${signedJson.slice(1)}}`;
assert(verifyAirtelCallbackHash(hashFirst, JSON.parse(hashFirst), AIRTEL_KEY).valid, "hash member first in the body also verifies");

console.log("Airtel payout outcomes (Disbursement-APIs v2 error codes)");
const resp = (code: string, txStatus?: string) => ({
  data: txStatus ? { transaction: { status: txStatus, airtel_money_id: "AM1" } } : undefined,
  status: { response_code: code, success: false },
});
assert(classifyAirtelDisbursement(200, resp("DP00900001001", "TS")).state === "SUCCESS", "TS -> success");
assert(classifyAirtelDisbursement(200, resp("DP00900001001")).state === "SUCCESS", "code 1001 -> success");
assert(classifyAirtelDisbursement(200, resp("DP00900001007")).state === "FAILED", "insufficient funds -> failed");
assert(classifyAirtelDisbursement(200, resp("DP00900001003")).state === "FAILED", "daily limit -> failed");
for (const code of ["DP00900001000", "DP00900001006", "DP00900001014", "DP00900001017", "DP00900001011"]) {
  assert(classifyAirtelDisbursement(200, resp(code)).state === "PENDING", `${code} is NOT a failure (resolve by enquiry)`);
}
assert(classifyAirtelDisbursement(200, resp("DP00900001000", "TA")).state === "PENDING", "TA (ambiguous) -> pending");
assert(classifyAirtelDisbursement(200, resp("DP00900001006", "TIP")).state === "PENDING", "TIP -> pending");
assert(classifyAirtelDisbursement(200, resp("DP00900001005", "TF")).state === "FAILED", "TF -> failed");
assert(classifyAirtelDisbursement(500, {}).state === "UNKNOWN", "HTTP 500 without a status -> unknown (never failed)");
assert(classifyAirtelDisbursement(200, { status: { response_code: "DP99999999999" } }).state === "UNKNOWN", "unrecognised code on 200 -> unknown");
assert(classifyAirtelDisbursement(400, { message: "bad request" }).state === "FAILED", "HTTP 400 rejection -> failed (nothing sent)");

console.log("Airtel PIN encryption");
// Public key printed on Airtel's Encryption page (bare base64 SPKI, 1024-bit)
const AIRTEL_DOC_KEY =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCkq3XbDI1s8Lu7SpUBP+bqOs/MC6PKWz6n/0UkqTiOZqKqaoZClI3BUDTrSIJsrN1Qx7ivBzsaAYfsB0CygSSWay4iyUcnMVEDrNVOJwtWvHxpyWJC5RfKBrweW9b8klFa/CfKRtkK730apy0Kxjg+7fF0tB4O3Ic9Gxuv4pFkbQIDAQAB";
const encPin = encryptAirtelPin("1234", AIRTEL_DOC_KEY);
assert(Buffer.from(encPin, "base64").length === 128, "bare base64 key accepted; output is a 128-byte (1024-bit) RSA block");
assert(encryptAirtelPin("1234", AIRTEL_DOC_KEY) !== encPin, "PKCS1 padding is randomised (no fixed ciphertext)");
assert(parseAirtelKeyExpiry("12-08-2024 21:29:26") === Date.UTC(2024, 7, 12, 21, 29, 26), "key expiry parsed (dd-MM-yyyy HH:mm:ss)");
assert(parseAirtelKeyExpiry("garbage") === null, "bad expiry ignored");

console.log("Credit packages");
const pkgs = getCreditPackages();
assert(pkgs.length > 0 && pkgs.every((p) => p.amountUgx > 0 && p.credits > 0), "packages are positive");
assert(findCreditPackage("pkg_500")?.amountUgx === 500, "pkg_500 costs 500 UGX");
assert(findCreditPackage("pkg_does_not_exist") === undefined, "unknown package rejected");

console.log("Uganda phone routing");
assert(normalizeUgandaPhone("0771819679").carrier === "MTN", "077 -> MTN");
assert(normalizeUgandaPhone("+256 731 234 567").carrier === "AIRTEL", "073 -> AIRTEL");
assert(normalizeUgandaPhone("256701234567").airtelMsisdn === "701234567", "Airtel 9-digit msisdn");
assert(normalizeUgandaPhone("0771819679").payleoMsisdn === "256771819679", "PayLeo 256 msisdn");
assert(!normalizeUgandaPhone("12345").isValid, "short number invalid");

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
