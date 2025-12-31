// file: src/config/email.config.ts

import { env } from "@/env";

export const EMAIL_CONFIG = {
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
  from: env.SMTP_FROM || env.SMTP_USER,
} as const;

export const EMAIL_ENABLED = Boolean(
  env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS
);
