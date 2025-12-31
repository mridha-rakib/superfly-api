// file: src/modules/password-reset/password-reset.type.ts

/**
 * Create OTP payload
 */
export type CreateOTPPayload = {
  userId: string;
  otp: string;
  expiresAt: Date;
};

/**
 * Verify OTP payload
 */
export type VerifyOTPPayload = {
  userId: string;
  otp: string;
};

/**
 * OTP response
 */
export type OTPResponse = {
  _id: string;
  userId: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  isUsed: boolean;
  createdAt: Date;
};
