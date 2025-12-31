// file: src/modules/email-verification/email-verification.interface.ts

import type { Document } from "mongoose";

/**
 * Email Verification OTP Document
 */
export interface IEmailVerificationOTP extends Document {
  userId: string;
  email: string;
  code: string;
  expiresAt: Date;
  verified: boolean;
  verifiedAt?: Date;
  attempts: number;
  lastAttemptAt?: Date;
  maxAttempts: number;
  isUsed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Email Verification Service Response Types
 */
export interface ICreateOTPResponse {
  otp: string;
  expiresAt: Date;
  expiresInMinutes: number;
}

export interface IVerifyOTPResponse {
  userId: string;
  email: string;
  verified: true;
}

export interface IResendOTPResponse {
  message: string;
  expiresAt: Date;
  expiresInMinutes: number;
}

export interface IOTPResendStatus {
  canResend: boolean;
  reason?: string;
  nextResendTime?: Date;
  attemptsRemaining?: number;
}
