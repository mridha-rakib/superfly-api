// file: src/modules/email-verification/email-verification.model.ts

import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { model } from "mongoose";
import type { IEmailVerificationOTP } from "./email-verification.types";

const emailVerificationOTPSchema =
  BaseSchemaUtil.createSchema<IEmailVerificationOTP>({
    userId: {
      type: String,
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },

    // Track which user type this OTP is for
    userType: {
      type: String,
      enum: ["super_admin", "admin", "cleaner", "client"],
      required: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      length: 4,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    verified: {
      type: Boolean,
      default: false,
      index: true,
    },

    verifiedAt: {
      type: Date,
    },

    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastAttemptAt: {
      type: Date,
    },

    maxAttempts: {
      type: Number,
      default: 100,
      required: true,
    },
  });

// ✅ Compound indexes for efficient queries
emailVerificationOTPSchema.index({ userId: 1, userType: 1, verified: 1 });
emailVerificationOTPSchema.index({ email: 1, userType: 1, verified: 1 });
emailVerificationOTPSchema.index({ userId: 1, email: 1, expiresAt: 1 });

// TTL index - auto-delete after 24 hours
emailVerificationOTPSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 86400 }
);

export const EmailVerificationOTP = model<IEmailVerificationOTP>(
  "EmailVerificationOTP",
  emailVerificationOTPSchema
);
