// file: src/middlewares/rate-limit.middleware.ts

import rateLimit from "express-rate-limit";
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP",
  standardHeaders: true,
  legacyHeaders: false,
});

// For auth endpoints (stricter)
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
  message: "Too many login attempts, please try again later",
});
