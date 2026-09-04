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
]);

const MULTER_MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB
const MESSAGE_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const GENERAL_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const VIDEO_MAX_FILE_SIZE = 150 * 1024 * 1024; // 150MB

const storage = multer.memoryStorage();

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf("."));
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".svg", ".mp4", ".mov", ".webm"];
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) && !allowedExts.includes(ext)) {
    cb(new AppError(StatusCodes.BAD_REQUEST, "Only image and video files (.jpg, .png, .webp, .mp4, .mov) are supported"));
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
          if (fieldName !== "image" && fieldName !== "video" && file.size > GENERAL_MAX_FILE_SIZE) {
            return next(new AppError(StatusCodes.BAD_REQUEST, "File size must not exceed 20MB"));
          }
          const fileName = generateUploadFileName({ originalName: file.originalname });

          if (fieldName === "video") {
            const rawExt = file.originalname.includes(".")
              ? file.originalname.substring(file.originalname.lastIndexOf(".")).toLowerCase()
              : ".mp4";
            const videoExt = [".mov", ".webm", ".mp4"].includes(rawExt) ? rawExt : ".mp4";
            const filePath = await uploadFile(file.buffer, `${fileName}${videoExt}`, file.mimetype || "video/mp4");
            console.log("[processAndUpload] uploaded video:", filePath);
            if (!req.body) req.body = {};
            req.body.video = filePath;
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
