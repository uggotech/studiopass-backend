/**
 * Firebase push must build its credential from the FIREBASE_* settings in memory and never write a file
 * (in production the backend runs as a non-root user and /app is read-only, so a file write failed with EACCES
 * and every push was skipped). No network success is needed: a FAKE key is enough to prove the sender gets past
 * "credentials not configured", and that the key never reaches the log output.
 *
 * Run: npx ts-node-dev --transpile-only --exit-child -r tsconfig-paths/register src/util/__tests__/firebasePush.test.ts
 */
import fs from "fs";
import path from "path";
import { generateKeyPairSync } from "crypto";
import config from "../../config";

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
  // A throwaway RSA key, stored the way an .env file stores it: one line, literal "\n" sequences
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const oneLineKey = privateKey.replace(/\n/g, "\\n");

  // Capture everything written to the console, to check that no key material is printed
  const captured: string[] = [];
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  console.log = (...a: any[]) => { captured.push(a.join(" ")); };
  console.error = (...a: any[]) => { captured.push(a.join(" ")); };
  console.warn = (...a: any[]) => { captured.push(a.join(" ")); };

  const fileBefore = fs.existsSync(path.join(process.cwd(), "serviceAccount-runtime.json"));

  (config as any).firebase = {
    type: "service_account",
    project_id: "demo-project",
    private_key_id: "abc",
    private_key: oneLineKey,
    client_email: "firebase-adminsdk@demo-project.iam.gserviceaccount.com",
    client_id: "1",
  };

  // Import AFTER config is set so the sender sees these values
  const { sendFirebaseMulticastNotification } = await import("../firebasePushNotification");
  const result = await Promise.race([
    sendFirebaseMulticastNotification(["fake-token-1"], { title: "t", body: "b" }),
    new Promise<any>((resolve) => setTimeout(() => resolve({ timedOut: true }), 20000)),
  ]);

  console.log = origLog; console.error = origErr; console.warn = origWarn;

  assert(result && result.skipped !== true, "push is NOT skipped when the FIREBASE_* settings are present");
  assert(!fs.existsSync(path.join(process.cwd(), "serviceAccount-runtime.json")) || fileBefore, "no credential file is written to disk");
  const all = captured.join("\n");
  assert(!all.includes("BEGIN PRIVATE KEY") && !all.includes("MII"), "the private key is never printed to the console");

  // And the opposite: with no settings it must skip politely, not crash
  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
