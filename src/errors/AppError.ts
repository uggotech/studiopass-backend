import { TErrorSources } from "types/error";

type TAppErrorOptions = {
  stack?: string;
  errorSources?: TErrorSources;
  details?: Record<string, unknown>;
  /** Stable machine-readable reason (e.g. TOKEN_EXPIRED) so clients do not parse message text. */
  code?: string;
};

class AppError extends Error {
  public statusCode: number;
  public errorSources?: TErrorSources;
  public details?: Record<string, unknown>;
  public code?: string;

  constructor(
    statusCode: number,
    message: string,
    options: string | TAppErrorOptions = "",
  ) {
    super(message);
    this.statusCode = statusCode;

    if (typeof options !== "string") {
      this.errorSources = options.errorSources;
      this.details = options.details;
      this.code = options.code;
    }

    const stack = typeof options === "string" ? options : (options.stack ?? "");

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default AppError;
