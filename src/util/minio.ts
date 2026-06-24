import { Client } from "minio";
import { logger } from "../logger/logger";
import config from "../config";

let minioClient: Client | null = null;

const getClient = (): Client => {
  if (!minioClient) {
    minioClient = new Client({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
  }
  return minioClient;
};

const ensureBucket = async (): Promise<void> => {
  try {
    const client = getClient();
    const exists = await client.bucketExists(config.minio.bucket);
    if (!exists) {
      await client.makeBucket(config.minio.bucket, "us-east-1");
      // Set public read policy
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${config.minio.bucket}/*`],
          },
        ],
      };
      await client.setBucketPolicy(config.minio.bucket, JSON.stringify(policy));
      logger.info(`[minio] Bucket "${config.minio.bucket}" created with public read`);
    } else {
      logger.info(`[minio] Bucket "${config.minio.bucket}" exists`);
    }
  } catch (error) {
    logger.error(`[minio] Failed to ensure bucket: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const uploadFile = async (
  buffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<string> => {
  const client = getClient();
  await client.putObject(config.minio.bucket, fileName, buffer, buffer.length, {
    "Content-Type": contentType,
  });
  return `${config.minio.bucket}/${fileName}`;
};

const deleteFile = async (fileName: string): Promise<void> => {
  const client = getClient();
  await client.removeObject(config.minio.bucket, fileName);
};

const getPresignedUrl = async (fileName: string, expiry: number = 3600): Promise<string> => {
  const client = getClient();
  return client.presignedGetObject(config.minio.bucket, fileName, expiry);
};

const initMinio = async (): Promise<void> => {
  try {
    await ensureBucket();
    logger.info("[minio] MinIO client initialized");
  } catch (error) {
    logger.warn(`[minio] MinIO unavailable, file uploads will fail: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export { initMinio, uploadFile, deleteFile, getPresignedUrl, ensureBucket };
