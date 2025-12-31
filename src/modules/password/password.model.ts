// file: src/modules/password-reset/password-reset.model.ts

import { OTP } from "@/constants/app.constants";
import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { model } from "mongoose";
import type { IPasswordResetOTP } from "./password.interface";

/**
 * Password Reset OTP Schema
 * Stores temporary OTP codes for password reset
 * Uses TTL index to auto-delete expired records
 */
const passwordResetOTPSchema = BaseSchemaUtil.createSchema<IPasswordResetOTP>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  otp: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // TTL index - auto-delete
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: OTP.MAX_ATTEMPTS,
  },
  isUsed: {
    type: Boolean,
    default: false,
    index: true,
  },
  usedAt: {
    type: Date,
  },
});

// Composite index for efficient queries
passwordResetOTPSchema.index({ userId: 1, isUsed: 1 });
passwordResetOTPSchema.index({ userId: 1, expiresAt: 1 });

export const PasswordResetOTP = model<IPasswordResetOTP>(
  "PasswordResetOTP",
  passwordResetOTPSchema
);
