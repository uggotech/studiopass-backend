import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import jwt from "jsonwebtoken";
import config from "../config";
import compression from "compression";
import { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../logger/logger";

// ============ HELMET ============
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// ============ RATE LIMITERS ============
// Many listeners share one carrier IP and a studio shares one office IP, so a pure per-IP budget
// is hit by innocent users. A request carrying a VALID access token is counted per user instead;
// everything else (login, anonymous, forged tokens) stays per IP. The token is verified, never
// just decoded, so nobody can mint fresh budgets by inventing user ids.
const RATE_LIMIT_IP_MAX = Number(process.env.RATE_LIMIT_IP_MAX) || 1000;
const RATE_LIMIT_USER_MAX = Number(process.env.RATE_LIMIT_USER_MAX) || 3000;

const verifiedUserKey = (req: Request): string | null => {
  const cached = (req as any)._rateLimitUser;
  if (cached !== undefined) return cached;
  let key: string | null = null;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), config.jwt.jwt_secret as string) as any;
      if (payload?.userId) key = `u:${payload.userId}`;
    } catch {
      // expired / invalid -> counted per IP
    }
  }
  (req as any)._rateLimitUser = key;
  return key;
};

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: (req: Request) => (verifiedUserKey(req) ? RATE_LIMIT_USER_MAX : RATE_LIMIT_IP_MAX),
  keyGenerator: (req: Request) => verifiedUserKey(req) ?? ipKeyGenerator(req.ip || ""),
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Provider callbacks (e.g. Airtel) all come from one IP; they are guarded by allowlists instead
  skip: (req: Request) => req.originalUrl.includes("/webhook/"),
});

// Per-user limit on mobile money push requests (each one triggers a PIN prompt on a phone)
export const paymentInitiateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => String((req as any).user?.id || (req as any).user?._id || "anonymous"),
  message: {
    success: false,
    message: "Too many payment attempts. Please wait a few minutes and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: {
    success: false,
    message: "Too many requests for this operation.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============ MONGO SANITIZE (Express 5 compatible) ============
// express-mongo-sanitize is incompatible with Express 5 (req.query is getter-only).
// We implement our own by stripping $-prefixed keys during query parsing.
const sanitizeObject = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const sanitized: any = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$")) {
      logger.warn(`MongoDB injection attempt: stripped key "${key}"`);
      continue;
    }
    sanitized[key] = sanitizeObject(obj[key]);
  }
  return sanitized;
};

// Custom query parser that strips $ keys — used by app.set('query parser')
export const sanitizeQueryParser = (str: string) => {
  if (!str) return {};
  // Use URLSearchParams for simple flat query strings
  const params = new URLSearchParams(str);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key.startsWith("$")) {
      logger.warn(`MongoDB injection attempt in query: stripped key "${key}"`);
      continue;
    }
    result[key] = value;
  }
  return result;
};

// Middleware to sanitize req.body and req.params (req.query handled by parser above)
export const sanitizeInput: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  // Sanitize req.body (already parsed by express.json)
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize req.params (path parameters)
  if (req.params && typeof req.params === "object") {
    for (const key of Object.keys(req.params)) {
      if (key.startsWith("$")) {
        logger.warn(`MongoDB injection attempt in params: "${key}"`);
        delete req.params[key];
      }
    }
  }

  next();
};

// ============ COMPRESSION ============
export const compressionConfig: RequestHandler = compression({
  filter: (req: Request, res: Response) => {
    if (req.headers["x-no-compression"]) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024,
  level: 1, 
}) as RequestHandler;

// ============ INPUT SANITIZATION (XSS only, NOT Mongo) ============
export const additionalSanitization = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  // ✅ Only sanitize XSS - MongoDB injection handled by mongoSanitize
  const sanitizeString = (str: string): string => {
    return str
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/javascript:/gi, "")
      .replace(/on\w+\s*=/gi, "");
  };

  const sanitizeObject = (obj: any): any => {
    if (typeof obj === "string") return sanitizeString(obj);
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (obj && typeof obj === "object") {
      const sanitized: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          // ✅ Only sanitize keys starting with $ (MongoDB operators)
          if (key.startsWith("$")) {
            logger.warn(
              `Suspicious key "${key}" in request body from ${req.ip}`
            );
            continue; // Skip this key entirely
          }
          sanitized[key] = sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    try {
      req.body = sanitizeObject(req.body);
    } catch (error) {
      logger.warn("Error sanitizing request body");
    }
  }

  next();
};
