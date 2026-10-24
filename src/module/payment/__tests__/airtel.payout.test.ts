/**
 * Airtel payout test against a pretend Airtel server (no DB, no real money, no network).
 * Checks the exact request Airtel receives and how each documented answer is classified.
 *
 * Run: npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/module/payment/__tests__/airtel.payout.test.ts
 */
import http from "http";
import crypto from "crypto";
import { AddressInfo } from "net";
import config from "../../../config";
import { initiateAirtelDisbursement, getAirtelDisbursementStatus } from "../airtel.service";

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

const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
const keyBody = publicKey.export({ type: "spki", format: "der" }).toString("base64");

let keyEndpointOk = false;
let keyRequests = 0;
let lastPost: { headers: http.IncomingHttpHeaders; body: any } | null = null;
let postScenario = "success";
const enquiryScenario = new Map<string, any>();
const enquiryUrls: string[] = [];

const server = http.createServer((req, res) => {
  const url = req.url || "";
  res.setHeader("Content-Type", "application/json");
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (url.startsWith("/auth/oauth2/token")) {
      return res.end(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }));
    }
    if (url.startsWith("/v1/rsa/encryption-keys")) {
      keyRequests++;
      if (!keyEndpointOk) {
        res.statusCode = 500;
        return res.end("{}");
      }
      return res.end(
        JSON.stringify({
          data: { key_id: 100, key: keyBody, valid_upto: "12-08-2099 21:29:26" },
          status: { code: "200", success: true, response_code: "DP02010001001" },
        }),
      );
    }
    if (req.method === "POST" && url.startsWith("/standard/v2/disbursements/")) {
      lastPost = { headers: req.headers, body: JSON.parse(raw) };
      const id = lastPost.body.transaction.id;
      const ok = (status: string, code: string) =>
        res.end(
          JSON.stringify({
            data: { transaction: { airtel_money_id: `AM-${id}`, id, status } },
            status: { code: "200", message: "x", response_code: code, success: status === "TS" },
          }),
        );
      switch (postScenario) {
        case "success":
          return ok("TS", "DP00900001001");
        case "insufficient":
          return res.end(JSON.stringify({ status: { code: "200", response_code: "DP00900001007", success: false } }));
        case "ambiguous":
          return res.end(JSON.stringify({ status: { code: "200", response_code: "DP00900001000", success: false } }));
        case "duplicate":
          return res.end(JSON.stringify({ status: { code: "200", response_code: "DP00900001017", success: false } }));
        case "http500":
          res.statusCode = 500;
          return res.end("{}");
      }
    }
    const m = url.match(/^\/standard\/v2\/disbursements\/([^?]+)\?(.*)$/);
    if (req.method === "GET" && m) {
      enquiryUrls.push(url);
      return res.end(JSON.stringify(enquiryScenario.get(decodeURIComponent(m[1])) || {}));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  (config.airtel as any).token_url = `${base}/auth/oauth2/token`;
  (config.airtel as any).client_id = "mock";
  (config.airtel as any).client_secret = "mock";
  (config.payout as any).airtel_disbursement_url = `${base}/standard/v2/disbursements/`;
  (config.payout as any).airtel_disbursement_status_url = `${base}/standard/v2/disbursements/`;
  (config.payout as any).airtel_encryption_keys_url = `${base}/v1/rsa/encryption-keys`;
  (config.payout as any).airtel_disbursement_pin = "1234";
  (config.payout as any).airtel_disbursement_public_key = keyBody; // env fallback

  console.log("PIN key fallback (Airtel key endpoint down)");
  let r = await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "PRZ1700000000AAAAAA" });
  assert(keyRequests === 1 && r.state === "SUCCESS", "key fetch failed -> env fallback key used, payout still sent");

  console.log("Request Airtel receives");
  keyEndpointOk = true;
  r = await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "PRZ1700000000BBBBBB" });
  const body = lastPost!.body;
  assert(keyRequests === 2, "PIN encryption key fetched from Airtel's key endpoint");
  assert(body.payee.msisdn === "701234567" && body.payee.currency === "UGX", "payee has 9-digit msisdn and currency UGX");
  assert(!("wallet_type" in body.payee), "no wallet_type field");
  assert(body.transaction.type === "B2C" && body.transaction.amount === 500, "transaction type B2C and amount");
  assert(body.reference === body.transaction.id && body.transaction.id === "PRZ1700000000BBBBBB", "reference equals our transaction id");
  assert(Buffer.from(body.pin, "base64").length === 128 && body.pin !== "1234", "PIN sent RSA-encrypted (128-byte block), never in clear");
  assert(lastPost!.headers["x-country"] === "UG" && lastPost!.headers["x-currency"] === "UGX", "X-Country / X-Currency headers");
  assert(String(lastPost!.headers.authorization).startsWith("Bearer "), "bearer token sent");
  assert(r.state === "SUCCESS" && r.airtelMoneyId === "AM-PRZ1700000000BBBBBB", "success with Airtel receipt id");

  await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "PRZ1700000000CCCCCC" });
  assert(keyRequests === 2, "encryption key is cached (not fetched on every payout)");

  console.log("How each Airtel answer is treated");
  postScenario = "insufficient";
  assert((await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "T1" })).state === "FAILED", "insufficient funds -> failed");
  postScenario = "ambiguous";
  assert((await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "T2" })).state === "PENDING", "ambiguous -> pending, not failed");
  postScenario = "duplicate";
  assert((await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "T3" })).state === "PENDING", "duplicate id -> pending (check, never re-send)");
  postScenario = "http500";
  assert((await initiateAirtelDisbursement({ msisdn: "701234567", amount: 500, transactionId: "T4" })).state === "UNKNOWN", "HTTP 500 -> unknown, not failed");

  console.log("Status check (v2 enquiry)");
  enquiryScenario.set("E1", { data: { transaction: { id: "E1", status: "TS", airtel_money_id: "AM-E1", message: "Successfully credited." } }, status: { response_code: "DP00900001001", success: false } });
  enquiryScenario.set("E2", { data: { transaction: { id: "E2", status: "TF", message: "failed" } }, status: { response_code: "DP00900001005" } });
  enquiryScenario.set("E3", { status: { response_code: "DP00900001015", message: "not found" } });
  enquiryScenario.set("E4", { data: { transaction: { id: "E4", status: "TIP" } }, status: { response_code: "DP00900001006" } });
  const e1 = await getAirtelDisbursementStatus("E1");
  assert(e1.state === "SUCCESS" && e1.airtelMoneyId === "AM-E1", "TS -> success even though sample shows success:false");
  assert(enquiryUrls[0] === "/standard/v2/disbursements/E1?transactionType=B2C", "enquiry uses the v2 path with ?transactionType=B2C");
  assert((await getAirtelDisbursementStatus("E2")).state === "FAILED", "TF -> failed");
  const e3 = (await getAirtelDisbursementStatus("E3")).state;
  assert(e3 === "PENDING" || e3 === "UNKNOWN", "'not found' keeps waiting (never concluded as failed or paid)");
  assert((await getAirtelDisbursementStatus("E4")).state === "PENDING", "TIP -> pending");

  server.close();
  try {
    const { default: redisClient } = await import("../../../redis/redisClient");
    await redisClient.del("airtel:oauth:token"); // do not leave the mock token in the dev Redis
  } catch {}
  console.log(`\n${passed}/${total} passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
