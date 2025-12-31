// file: src/modules/password-reset/password-reset.schema.ts

import { z } from "zod";

/**
 * Password Reset Schemas
 */

// ============================================
// FORGOT PASSWORD SCHEMA
// ============================================

/**
 * Request password reset OTP
 * POST /auth/forgot-password
 * Body: { email }
 */
export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").toLowerCase(), // ✅ Normalize to lowercase
  }),
});

// ============================================
// VERIFY PASSWORD RESET OTP SCHEMA
// ============================================

/**
 * Verify OTP for password reset
 * POST /auth/verify-password-otp
 * Body: { email, otp }
 */
export const verifyPasswordOTPSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").toLowerCase(), // ✅ Normalize to lowercase
    otp: z
      .string()
      .length(4, "OTP must be exactly 4 digits")
      .regex(/^\d{4}$/, "OTP must contain only digits"),
  }),
});

// ============================================
// RESET PASSWORD SCHEMA
// ============================================

/**
 * Reset password with verified OTP
 * POST /auth/reset-password
 * Body: { email, otp, newPassword }
 */
export const resetPasswordSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").toLowerCase(), // ✅ Normalize to lowercase
    otp: z
      .string()
      .length(4, "OTP must be exactly 4 digits")
      .regex(/^\d{4}$/, "OTP must contain only digits"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    // .max(128, "Password must not exceed 128 characters")
    // .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    // .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    // .regex(/[0-9]/, "Password must contain at least one number")
    // .regex(
    //   /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
    //   "Password must contain at least one special character"
    // ),
  }),
});

// ============================================
// RESEND PASSWORD RESET OTP SCHEMA
// ============================================

/**
 * Resend password reset OTP
 * POST /auth/resend-password-otp
 * Body: { email }
 */
export const resendPasswordOTPSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format").toLowerCase(),
  }),
});
