import admin from "firebase-admin";
import config from "config";

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

const normalizeFirebasePrivateKey = (value?: string) => {
  return value ? value.replace(/\\n/g, "\n") : undefined;
};

const getFirebaseApp = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  const projectId = config.firebase.project_id;
  const clientEmail = config.firebase.client_email;
  const privateKey = normalizeFirebasePrivateKey(config.firebase.private_key);

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    } as admin.ServiceAccount),
  });

  return firebaseApp;
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
      const response = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: Object.keys(data).length > 0 ? data : undefined,
      });

      successCount += response.successCount;
      failureCount += response.failureCount;
    } catch (error) {
      failureCount += chunk.length;
      logger.error("[Firebase Push] Failed to send multicast notification", { error });
    }
  }

  return { successCount, failureCount };
};