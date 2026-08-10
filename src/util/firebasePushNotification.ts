import admin from "firebase-admin";
import config from "config";
import fs from "fs";
import path from "path";

import { logger } from "logger/logger";

type TFirebasePushPayload = {
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, unknown>;
};

type TFirebasePushResult = {
  successCount: number;
  failureCount: number;
  skipped?: boolean;
};

const MAX_FCM_TOKENS_PER_REQUEST = 500;

let firebaseApp: admin.app.App | null = null;

const SERVICE_ACCOUNT_FILE = path.join(process.cwd(), "serviceAccount.json");
const SERVICE_ACCOUNT_RUNTIME = path.join(process.cwd(), "serviceAccount-runtime.json");

const ensureServiceAccountFile = (): string | null => {
  // 1. If original serviceAccount.json exists and is a file, use it
  try {
    const stat = fs.statSync(SERVICE_ACCOUNT_FILE);
    console.log("[Firebase Push] serviceAccount.json exists — isFile:", stat.isFile(), "isDir:", stat.isDirectory());
    if (stat.isFile()) {
      return SERVICE_ACCOUNT_FILE;
    }
  } catch (e: any) {
    console.log("[Firebase Push] serviceAccount.json not found:", e.code);
  }

  // 2. If runtime file already generated, use it
  try {
    const stat = fs.statSync(SERVICE_ACCOUNT_RUNTIME);
    if (stat.isFile()) {
      return SERVICE_ACCOUNT_RUNTIME;
    }
  } catch {}

  // 3. Generate from env vars — parse the JSON properly
  const { project_id, client_email, private_key, private_key_id, client_id, auth_uri, token_uri, auth_provider_cert_url, client_cert_url, universe_domain, type } = config.firebase;

  if (!project_id || !client_email || !private_key) {
    return null;
  }

  try {
    const fixedKey = private_key.replace(/\\n/g, "\n");
    console.log("[Firebase Push] Private key BEFORE fix (first 80 chars):", private_key.substring(0, 80));
    console.log("[Firebase Push] Private key AFTER fix (first 80 chars):", fixedKey.substring(0, 80));
    console.log("[Firebase Push] Has literal backslash-n:", private_key.includes("\\n"));
    console.log("[Firebase Push] Has real newlines after fix:", fixedKey.includes("\n") && !fixedKey.includes("\\n"));

    const serviceAccount = {
      type: type || "service_account",
      project_id,
      private_key_id,
      private_key: fixedKey,
      client_email,
      client_id,
      auth_uri,
      token_uri,
      auth_provider_x509_cert_url: auth_provider_cert_url,
      client_x509_cert_url: client_cert_url,
      universe_domain,
    };

    const jsonContent = JSON.stringify(serviceAccount, null, 2);
    console.log("[Firebase Push] JSON private_key field (first 100 chars):", jsonContent.substring(jsonContent.indexOf('"private_key"'), jsonContent.indexOf('"private_key"') + 120));

    fs.writeFileSync(SERVICE_ACCOUNT_RUNTIME, jsonContent, "utf-8");
    console.log("[Firebase Push] Generated runtime service account file");
    return SERVICE_ACCOUNT_RUNTIME;
  } catch (e) {
    console.error("[Firebase Push] Failed to write service account file:", e);
    return null;
  }
};

const getFirebaseApp = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  const filePath = ensureServiceAccountFile();
  if (!filePath) {
    console.warn("[Firebase Push] No service account found — push will be skipped");
    return null;
  }

  try {
    console.log("[Firebase Push] Loading service account from:", filePath);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(filePath),
    });
    console.log("[Firebase Push] Initialized successfully");
    return firebaseApp;
  } catch (e: any) {
    console.error("[Firebase Push] Failed to initialize:", e.message);
    return null;
  }
};

const normalizeData = (data?: Record<string, unknown>) => {
  const normalized: Record<string, string> = {};

  Object.entries(data ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    normalized[key] = typeof value === "string" ? value : JSON.stringify(value);
  });

  return normalized;
};

const uniqueTokens = (tokens: string[]) => {
  return [...new Set(tokens.map((token) => token.trim()).filter(Boolean))];
};

const chunkTokens = (tokens: string[]) => {
  const chunks: string[][] = [];

  for (let index = 0; index < tokens.length; index += MAX_FCM_TOKENS_PER_REQUEST) {
    chunks.push(tokens.slice(index, index + MAX_FCM_TOKENS_PER_REQUEST));
  }

  return chunks;
};

export const sendFirebaseNotification = async (
  token: string,
  payload: TFirebasePushPayload,
): Promise<TFirebasePushResult> => {
  return sendFirebaseMulticastNotification([token], payload);
};

export const sendFirebaseMulticastNotification = async (
  tokens: string[],
  payload: TFirebasePushPayload,
): Promise<TFirebasePushResult> => {
  const normalizedTokens = uniqueTokens(tokens);

  if (!normalizedTokens.length) {
    return { successCount: 0, failureCount: 0 };
  }

  const app = getFirebaseApp();

  if (!app) {
    logger.warn("[Firebase Push] Credentials not configured. Push skipped.");
    return { successCount: 0, failureCount: 0, skipped: true };
  }

  const messaging = app.messaging();
  const data = normalizeData(payload.data);

  let successCount = 0;
  let failureCount = 0;

  for (const chunk of chunkTokens(normalizedTokens)) {
    try {
      console.log(`[Firebase Push] Sending to ${chunk.length} token(s)...`);
      const response = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: Object.keys(data).length > 0 ? data : undefined,
      });

      console.log(`[Firebase Push] Response — success: ${response.successCount}, failure: ${response.failureCount}`);

      // Log individual failures for debugging
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.error(`[Firebase Push] Token[${idx}] failed:`, resp.error?.message || resp.error);
          }
        });
      }

      successCount += response.successCount;
      failureCount += response.failureCount;
    } catch (error) {
      failureCount += chunk.length;
      console.error("[Firebase Push] Failed to send multicast notification:", error);
      logger.error("[Firebase Push] Failed to send multicast notification", { error });
    }
  }

  return { successCount, failureCount };
};