import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import multer from "multer";
import sharp from "sharp";
import AppError from "../errors/AppError";
import { uploadFile } from "../util/minio";
import generateUploadFileName from "../util/generateUploadFileName";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

const MULTER_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MESSAGE_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const GENERAL_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const storage = multer.memoryStorage();

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf("."));
  const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".svg"];
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) && !allowedExts.includes(ext)) {
    cb(new AppError(StatusCodes.BAD_REQUEST, "Only .jpeg, .jpg, .png, .webp, .svg files supported"));
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
          if (fieldName !== "image" && file.size > GENERAL_MAX_FILE_SIZE) {
            return next(new AppError(StatusCodes.BAD_REQUEST, "File size must not exceed 20MB"));
          }
          const fileName = generateUploadFileName({ originalName: file.originalname });

          let processedBuffer: Buffer;
          let contentType = "image/webp";

          if (file.mimetype === "image/svg+xml") {
            // Don't process SVGs
            processedBuffer = file.buffer;
            contentType = "image/svg+xml";
          } else {
            const isOptionImage = fieldName === "optionImage" || (req.body && req.body.isOptionImage === "true");
            const initialQuality = isOptionImage ? 65 : 80;

            processedBuffer = await sharp(file.buffer)
              .resize({ width: 1600, withoutEnlargement: true })
              .webp({ quality: initialQuality })
              .toBuffer();

            // Check if file size > 400KB (400 * 1024 bytes)
            const MAX_400KB = 400 * 1024;
            if (isOptionImage && processedBuffer.length > MAX_400KB) {
              // Pass 1: 80% of current quality (65 * 0.8 = 52)
              processedBuffer = await sharp(processedBuffer)
                .webp({ quality: 52 })
                .toBuffer();

              if (processedBuffer.length > MAX_400KB) {
                // Pass 2: 80% of current quality (52 * 0.8 = 42)
                processedBuffer = await sharp(processedBuffer)
                  .webp({ quality: 42 })
                  .toBuffer();
                // If still > 400KB after 2nd pass, skip further compression
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
    } catch (error) {
      return next(new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Image processing failed"));
    }

    next();
  });
};

export default processAndUpload;
