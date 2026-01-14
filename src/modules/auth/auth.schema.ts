// file: src/modules/auth/auth.schema.ts

import { MESSAGES, ROLES } from "@/constants/app.constants";
import { z } from "zod";

/**
 * Register schema with conditional password validation
 */
export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
    password: z.string().min(8, MESSAGES.VALIDATION.PASSWORD_TOO_SHORT),
    fullName: z.string().min(2).max(100),
    phoneNumber: z.string().min(6).max(20),
    address: z.string().min(2).max(250),
    role: z.enum([ROLES.CLIENT]).optional().default(ROLES.CLIENT),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
    password: z.string().min(1, "Password is required"),
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
    code: z.string().length(4, "Verification code must be 4 digits"),
  }),
});

export const requestPasswordResetSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
  }),
});

export const verifyOTPSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
    otp: z.string().length(4, "OTP must be 4 digits"),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
    otp: z.string().length(4, "OTP must be 4 digits"),
    newPassword: z.string().min(8, MESSAGES.VALIDATION.PASSWORD_TOO_SHORT),
  }),
});

export const refreshTokenSchema = z.object({
  body: z.object({}).optional(),
});

export const resendVerificationCodeSchema = z.object({
  body: z.object({
    email: z.string().email(MESSAGES.VALIDATION.INVALID_EMAIL),
    userType: z
      .enum([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.CLEANER, ROLES.CLIENT])
      .optional(),
    userName: z.string().optional(),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, MESSAGES.VALIDATION.PASSWORD_TOO_SHORT),
  }),
});
