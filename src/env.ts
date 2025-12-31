// file: src/env.ts
import { z } from "zod/v4";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  APP_NAME: z.string().default("SuperFly - service provider Platform"),
  BASE_URL: z.string().default("/api/v1"),
  PORT: z.coerce.number().default(3000),
  MONGO_URI: z.url().nonempty("MONGO_URI is required"),
  JWT_SECRET: z.string().default("lp01yPo31ACozd4pDI9Z1DSD30A"),
  JWT_REFRESH_SECRET: z.string().default("rwN17KgtvujqVe6jANmu3r5FIFY0jw"),
  JWT_EXPIRY: z.string().default("7d"),
  JWT_REFRESH_EXPIRY: z.string().default("30d"),
  SALT_ROUNDS: z.coerce.number().default(12),

  // Frontend URL
  CLIENT_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  SMTP_HOST: z.string().min(1, "SMTP_HOST is required"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().min(1, "SMTP_USER is required"),
  SMTP_PASS: z.string().min(1, "SMTP_PASS is required"),
  SMTP_FROM: z.string().email().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),

  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

try {
  // eslint-disable-next-line node/no-process-env
  envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(
      "Missing environment variables:",
      error.issues.flatMap((issue) => issue.path)
    );
  } else {
    console.error(error);
  }
  process.exit(1);
}

// eslint-disable-next-line node/no-process-env
export const env = envSchema.parse(process.env);
