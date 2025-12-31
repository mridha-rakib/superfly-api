// src/middlewares/not-found.middleware.ts
import type { NextFunction, Request, Response } from "express";

import { HTTPSTATUS } from "@/config/http.config";
import { ErrorCodeEnum } from "@/enums/error-code.enum";

export function notFound(req: Request, res: Response, _next: NextFunction) {
  const requestId = req.id || (req.headers["x-request-id"] as string);

  return res.status(HTTPSTATUS.NOT_FOUND).json({
    success: false,
    message: `🔍 -  route ${req.method} ${req.originalUrl} not found`,
    errorCode: ErrorCodeEnum.RESOURCE_NOT_FOUND,
    requestId,
    timestamp: new Date().toISOString(),
  });
}
