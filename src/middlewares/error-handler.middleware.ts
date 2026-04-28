// file: src/middlewares/error-handler.middleware.ts
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";
import type { z } from "zod";

import { ZodError } from "zod";

import { HTTPSTATUS } from "@/config/http.config";
import { ErrorCodeEnum } from "@/enums/error-code.enum";
import { env } from "@/env";
import { AppError } from "@/utils/app-error.utils";

import { logger } from "./pino-logger.js";

// Zod error formatter
function formatZodError(res: Response, error: z.ZodError, requestId?: string) {
  const errors = error?.issues?.map((err) => ({
    field: err.path.join("."),
    message: err.message,
    code: err.code,
  }));

  return res.status(HTTPSTATUS.BAD_REQUEST).json({
    success: false,
    message: "Validation failed",
    errors,
    errorCode: ErrorCodeEnum.VALIDATION_ERROR,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
// MongoDB error handler
function handleMongoDBError(error: any, requestId?: string) {
  // Mongoose Validation Error
  if (error.name === "ValidationError") {
    const errors = Object.values(error.errors).map((err: any) => ({
      field: err.path,
      message: err.message,
      value: err.value,
    }));

    return {
      statusCode: HTTPSTATUS.BAD_REQUEST,
      message: "Database validation failed",
      errors,
      errorCode: ErrorCodeEnum.VALIDATION_ERROR,
      requestId,
    };
  }

  // MongoDB CastError (Invalid ObjectId)
  if (error.name === "CastError") {
    return {
      statusCode: HTTPSTATUS.BAD_REQUEST,
      message: `Invalid ${error.path}: ${error.value}`,
      errorCode: ErrorCodeEnum.VALIDATION_ERROR,
      requestId,
    };
  }

  if (error.name === "MongooseError" && error.message.includes("skip")) {
    return {
      statusCode: HTTPSTATUS.BAD_REQUEST,
      message: "Invalid pagination parameters",
      errorCode: ErrorCodeEnum.PAGINATION_INVALID_PAGE, // Need to add this
      requestId,
    };
  }

  // MongoDB Duplicate Key Error
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    return {
      statusCode: HTTPSTATUS.CONFLICT,
      message: `${field} already exists`,
      errorCode: ErrorCodeEnum.RESOURCE_CONFLICT,
      requestId,
    };
  }

  // MongoDB Connection Error
  if (
    error.name === "MongoNetworkError" ||
    error.name === "MongooseServerSelectionError"
  ) {
    return {
      statusCode: HTTPSTATUS.SERVICE_UNAVAILABLE,
      message: "Database connection error",
      errorCode: ErrorCodeEnum.DATABASE_CONNECTION_ERROR,
      requestId,
    };
  }

  return null;
}

function sanitizeRequestBody(req: Request) {
  const url = req.originalUrl || req.url || "";
  if (url.includes("/billing/webhook")) {
    return "[stripe webhook body omitted]";
  }

  if (Buffer.isBuffer(req.body)) {
    return "[raw request body omitted]";
  }

  if (
    url.includes("/quotes/intent") ||
    url.includes("/quotes/confirm") ||
    url.includes("/quotes/payment-status") ||
    url.includes("/billing/checkout-session")
  ) {
    return redactSensitiveValues(req.body);
  }

  return req.body;
}

function redactSensitiveValues(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item));
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, unknown>
  >((safe, [key, nestedValue]) => {
    if (
      /card|payment|stripe|token|secret|password|authorization/i.test(key)
    ) {
      safe[key] = "[redacted]";
    } else {
      safe[key] = redactSensitiveValues(nestedValue);
    }
    return safe;
  }, {});
}

export const errorHandler: ErrorRequestHandler = (
  error,
  req: Request,
  res: Response,
  _: NextFunction
): any => {
  const requestId = req.id || (req.headers["x-request-id"] as string);

  logger.error(
    {
      requestId,
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get("User-Agent"),
      ip: req.ip || req.connection.remoteAddress,
      error: {
        name: error.name,
        message: error.message,
        stack: env.NODE_ENV === "development" ? error.stack : undefined,
      },
      body: sanitizeRequestBody(req),
      params: req.params,
      query: req.query,
    },
    `Error occurred on ${req.method} ${req.path}`
  );

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(HTTPSTATUS.BAD_REQUEST).json({
      success: false,
      message: "Invalid JSON format in request body",
      errorCode: ErrorCodeEnum.VALIDATION_ERROR,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (error instanceof ZodError) {
    return formatZodError(res, error, String(requestId));
  }

  const mongoError = handleMongoDBError(error, String(requestId));
  if (mongoError) {
    return res.status(mongoError.statusCode).json({
      success: false,
      message: mongoError.message,
      errors: mongoError.errors,
      errorCode: mongoError.errorCode,
      requestId: mongoError.requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      errorCode: error.errorCode,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (error.type === "entity.parse.failed") {
    return res.status(HTTPSTATUS.BAD_REQUEST).json({
      success: false,
      message: "Invalid request body format",
      errorCode: ErrorCodeEnum.VALIDATION_ERROR,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(HTTPSTATUS.BAD_REQUEST).json({
      success: false,
      message: "Request body too large",
      errorCode: ErrorCodeEnum.REQUEST_TOO_LARGE,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  if (error.status === 429) {
    return res.status(HTTPSTATUS.TOO_MANY_REQUESTS).json({
      success: false,
      message: "Too many requests, please try again later",
      errorCode: ErrorCodeEnum.AUTH_TOO_MANY_ATTEMPTS,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(HTTPSTATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message:
      env.NODE_ENV === "development"
        ? error.message || "Unknown error occurred"
        : "Internal Server Error",
    errorCode: ErrorCodeEnum.INTERNAL_SERVER_ERROR,
    requestId,
    timestamp: new Date().toISOString(),
    ...(env.NODE_ENV === "development" && {
      stack: error.stack,
      originalError: error.message,
    }),
  });
};
