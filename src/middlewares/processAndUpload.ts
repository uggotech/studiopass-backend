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

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB

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
  limits: { fileSize: MAX_FILE_SIZE },
}).fields([
  { name: "logo", maxCount: 1 },
  { name: "coverImage", maxCount: 1 },
  { name: "image", maxCount: 1 },
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
          const fileName = generateUploadFileName({ originalName: file.originalname });

          let processedBuffer: Buffer;
          let contentType = "image/webp";

          if (file.mimetype === "image/svg+xml") {
            // Don't process SVGs
            processedBuffer = file.buffer;
            contentType = "image/svg+xml";
          } else {
            // Resize and convert to WebP
            processedBuffer = await sharp(file.buffer)
              .resize({ width: 1600, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
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
