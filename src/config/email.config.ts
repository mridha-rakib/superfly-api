// file: src/config/email.config.ts

import { env } from "@/env";

const postmarkConfigured = Boolean(env.POSTMARK_API_TOKEN);
const smtpConfigured = Boolean(
  env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS
);

const provider = postmarkConfigured
  ? "postmark"
  : smtpConfigured
    ? "smtp"
    : "disabled";
const fromAddress = env.EMAIL_FROM_ADDRESS || env.SMTP_FROM || env.SMTP_USER || "";

export const EMAIL_CONFIG = {
  provider,
  from: {
    name: env.EMAIL_FROM_NAME || "",
    address: fromAddress,
  },
  replyTo: env.EMAIL_REPLY_TO || "",
  branding: {
    logoUrl: env.EMAIL_LOGO_URL || "",
    brandColor: env.EMAIL_BRAND_COLOR || "",
  },
  retry: {
    maxRetries: env.EMAIL_MAX_RETRIES ?? 0,
    delayMs: env.EMAIL_RETRY_DELAY_MS ?? 0,
  },
  postmark: {
    apiToken: env.POSTMARK_API_TOKEN || "",
    messageStream: env.POSTMARK_MESSAGE_STREAM || "outbound",
    sandboxMode: env.POSTMARK_SANDBOX_MODE ?? false,
  },
  smtp: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE ?? false,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  },
} as const;

export const EMAIL_ENABLED = provider !== "disabled";
