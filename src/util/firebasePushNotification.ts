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

/**
 * Build the Firebase credential. An optional `serviceAccount.json` next to the app wins (local development);
 * otherwise the FIREBASE_* settings are used DIRECTLY from memory. The container runs as a non-root user and
 * /app is read-only for it, so nothing may be written to disk here (a file write used to fail with EACCES and
 * every push was silently skipped). The private key is never logged.
 */
const buildCredential = (): admin.credential.Credential | null => {
  try {
    if (fs.statSync(SERVICE_ACCOUNT_FILE).isFile()) {
      return admin.credential.cert(SERVICE_ACCOUNT_FILE);
    }
  } catch {
    // no file: use the environment settings below
  }

  const { project_id, client_email, private_key } = config.firebase;
  if (!project_id || !client_email || !private_key) {
    logger.warn("[Firebase Push] FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are missing. Push skipped.");
    return null;
  }

  return admin.credential.cert({
    projectId: project_id,
    clientEmail: client_email,
    // Environment files store the key on one line with literal "\n" sequences
    privateKey: private_key.replace(/\\n/g, "\n"),
  });
};

const getFirebaseApp = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  try {
    const credential = buildCredential();
    if (!credential) {
      return null;
    }
    firebaseApp = admin.initializeApp({ credential });
    logger.info("[Firebase Push] Initialized");
    return firebaseApp;
  } catch (e: any) {
    logger.error(`[Firebase Push] Failed to initialize: ${e?.message}`);
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
        // High priority so phones show it at once (even in battery saver); the app creates this channel itself
        android: { priority: "high", notification: { channelId: "studiopass_default" } },
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