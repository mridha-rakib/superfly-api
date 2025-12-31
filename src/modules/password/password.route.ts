// file: src/modules/password-reset/password-reset.route.ts

/**
 * Password Reset Routes
 * ✅ All password reset endpoints
 * ✅ Proper REST conventions
 */

import { Router } from "express";
import { PasswordResetController } from "./password.controller";

const router = Router();
const controller = new PasswordResetController();

// ============================================
// PASSWORD RESET ENDPOINTS
// ============================================

/**
 * POST /auth/forgot-password
 * Request password reset OTP
 */
router.post("/forgot-password", controller.requestPasswordReset);

/**
 * POST /auth/verify-password-otp
 * Verify password reset OTP
 */
router.post("/verify-password-otp", controller.verifyPasswordOTP);

/**
 * POST /auth/reset-password
 * Reset password with verified OTP
 */
router.post("/reset-password", controller.resetPassword);

/**
 * POST /auth/resend-password-otp
 * Resend password reset OTP
 */
router.post("/resend-password-otp", controller.resendPasswordOTP);

export default router;
