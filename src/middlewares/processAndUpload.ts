import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import multer from "multer";
import sharp from "sharp";
import AppError from "../errors/AppError";
import { uploadFile } from "../util/minio";
import generateUploadFileName from "../util/generateUploadFileName";
import { logger } from "../logger/logger";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
]);

const MULTER_MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB
const MESSAGE_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const GENERAL_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const VIDEO_MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB
const AUDIO_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const storage = multer.memoryStorage();

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf("."));
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".svg", ".mp4", ".mov", ".webm", ".m4v", ".m4a", ".aac", ".mp3", ".wav", ".ogg"];
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) && !allowedExts.includes(ext)) {
    cb(new AppError(StatusCodes.BAD_REQUEST, "Only image, video, and audio files (.jpg, .png, .webp, .mp4, .mov, .m4v, .webm, .m4a, .mp3, .wav, .aac, .ogg) are supported"));
    return;
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MULTER_MAX_FILE_SIZE },
}).fields([
  { name: "logo", maxCount: 1 },
  { name: "coverImage", maxCount: 1 },
  { name: "image", maxCount: 1 },
  { name: "avatar", maxCount: 1 },
  { name: "optionImage", maxCount: 10 },
  { name: "video", maxCount: 1 },
  { name: "audio", maxCount: 1 },
]);

const processAndUpload = async (req: Request, _res: Response, next: NextFunction) => {
  upload(req, _res, async (err: unknown) => {
    if (err) {
      console.log("[processAndUpload] multer error:", err);
      return next(err);
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    console.log("[processAndUpload] files received:", files ? Object.keys(files) : "none");
    if (!files) return next();

    try {
      for (const [fieldName, fileArray] of Object.entries(files)) {
        for (const file of fileArray) {
          if (fieldName === "image" && file.size > MESSAGE_MAX_FILE_SIZE) {
            return next(new AppError(StatusCodes.BAD_REQUEST, "Message image file size must not exceed 10MB"));
          }
          if (fieldName === "video" && file.size > VIDEO_MAX_FILE_SIZE) {
            return next(new AppError(StatusCodes.BAD_REQUEST, "Video file size must not exceed 150MB"));
          }
          if (fieldName === "audio" && file.size > AUDIO_MAX_FILE_SIZE) {
            return next(new AppError(StatusCodes.BAD_REQUEST, "Audio file size must not exceed 25MB"));
          }
          if (fieldName !== "image" && fieldName !== "video" && fieldName !== "audio" && file.size > GENERAL_MAX_FILE_SIZE) {
            return next(new AppError(StatusCodes.BAD_REQUEST, "File size must not exceed 20MB"));
          }
          const fileName = generateUploadFileName({ originalName: file.originalname });

          if (fieldName === "video") {
            // Always emit standard MP4 after server-side transcode/compress
            const startSec = Number((req.body as any)?.trimStartSec ?? (req.body as any)?.startSec ?? 0);
            let processStatusVideo: ((buf: Buffer, opts: { startSec?: number }) => Promise<Buffer>) | null = null;
            let logVideoProcessError: ((m: string, e: unknown) => void) | null = null;
            try {
              const mod = await import("../shared/video/processStatusVideo");
              processStatusVideo = mod.processStatusVideo;
              logVideoProcessError = mod.logVideoProcessError;
            } catch (importErr) {
              logger.error("[processAndUpload] video processor module unavailable", {
                error: importErr instanceof Error ? importErr.message : String(importErr),
              });
            }

            try {
              if (!processStatusVideo) {
                throw new Error("processStatusVideo unavailable");
              }
              const processed = await processStatusVideo(file.buffer, {
                startSec: Number.isFinite(startSec) ? startSec : 0,
              });
              const filePath = await uploadFile(processed, `${fileName}.mp4`, "video/mp4");
              console.log("[processAndUpload] uploaded processed video:", filePath);
              if (!req.body) req.body = {};
              req.body.video = filePath;
            } catch (processErr) {
              if (logVideoProcessError) {
                logVideoProcessError("Status video processing failed", processErr);
              } else {
                logger.error("[processAndUpload] Status video processing failed", {
                  error: processErr instanceof Error ? processErr.message : String(processErr),
                });
              }
              // Fallback: store original if ffmpeg unavailable (still works, less optimized)
              const rawExt = file.originalname.includes(".")
                ? file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase()
                : ".mp4";
              const videoExt = [".mov", ".webm", ".mp4", ".m4v"].includes(rawExt) ? rawExt : ".mp4";
              const filePath = await uploadFile(
                file.buffer,
                `${fileName}${videoExt}`,
                file.mimetype || "video/mp4",
              );
              console.log("[processAndUpload] uploaded raw video fallback:", filePath);
              if (!req.body) req.body = {};
              req.body.video = filePath;
            }
            continue;
          }

          if (fieldName === "audio") {
            const rawExt = file.originalname.includes(".")
              ? file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase()
              : ".m4a";
            const audioExt = [".m4a", ".aac", ".mp3", ".wav", ".ogg"].includes(rawExt) ? rawExt : ".m4a";
            const audioMime = file.mimetype && file.mimetype.startsWith("audio/") ? file.mimetype : "audio/m4a";
            const filePath = await uploadFile(file.buffer, `${fileName}${audioExt}`, audioMime);
            console.log("[processAndUpload] uploaded audio:", filePath);
            if (!req.body) req.body = {};
            req.body.audio = filePath;
            continue;
          }

          let processedBuffer: Buffer;
          let contentType = "image/webp";

          if (file.mimetype === "image/svg+xml") {
            // Don't process SVGs
            processedBuffer = file.buffer;
            contentType = "image/svg+xml";
          } else {
            const isOptionImage = fieldName === "optionImage" || (req.body && req.body.isOptionImage === "true");

            let resizeOptions: sharp.ResizeOptions = { width: 1600, withoutEnlargement: true, fit: "inside" };
            let quality = 80;

            if (fieldName === "logo") {
              resizeOptions = { width: 500, height: 500, fit: "inside", withoutEnlargement: true };
              quality = 85;
            } else if (fieldName === "avatar") {
              resizeOptions = { width: 500, height: 500, fit: "inside", withoutEnlargement: true };
              quality = 80;
            } else if (fieldName === "coverImage") {
              resizeOptions = { width: 1600, height: 900, fit: "inside", withoutEnlargement: true };
              quality = 80;
            } else if (fieldName === "image") {
              resizeOptions = { width: 1080, height: 1920, fit: "inside", withoutEnlargement: true };
              quality = 80;
            } else if (isOptionImage) {
              resizeOptions = { width: 800, height: 800, fit: "inside", withoutEnlargement: true };
              quality = 65;
            }

            processedBuffer = await sharp(file.buffer)
              .resize(resizeOptions)
              .webp({ quality, effort: 4, alphaQuality: 90 })
              .toBuffer();

            // Check if file size > 400KB for option images
            const MAX_400KB = 400 * 1024;
            if (isOptionImage && processedBuffer.length > MAX_400KB) {
              processedBuffer = await sharp(processedBuffer)
                .webp({ quality: 52, effort: 4, alphaQuality: 90 })
                .toBuffer();

              if (processedBuffer.length > MAX_400KB) {
                processedBuffer = await sharp(processedBuffer)
                  .webp({ quality: 42, effort: 4, alphaQuality: 90 })
                  .toBuffer();
              }
            }
          }

          const filePath = await uploadFile(processedBuffer, `${fileName}.webp`, contentType);
          console.log("[processAndUpload] uploaded:", fieldName, "->", filePath);

          // Attach the file path to the request body
          if (!req.body) req.body = {};
          req.body[fieldName] = filePath;
        }
      }
    } catch (error: any) {
      logger.error(`[processAndUpload] Error processing or uploading file: ${error?.message || error}`, {
        stack: error?.stack,
      });
      return next(new AppError(StatusCodes.INTERNAL_SERVER_ERROR, `Image upload failed: ${error?.message || error}`));
    }

    next();
  });
};

export default processAndUpload;
