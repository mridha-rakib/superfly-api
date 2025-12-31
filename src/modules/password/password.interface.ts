// file: src/modules/password-reset/password-reset.interface.ts

import type { Document, Types } from "mongoose";

/**
 * Password Reset OTP Document Interface
 */
export interface IPasswordResetOTP extends Document {
  _id: Types.ObjectId;
  userId: string;
  otp: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
