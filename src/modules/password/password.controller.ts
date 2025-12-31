// file: src/modules/password-reset/password-reset.controller.ts

/**
 * Password Reset Controller
 */

import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { AuthService } from "@/modules/auth/auth.service";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import {
  forgotPasswordSchema,
  resendPasswordOTPSchema,
  resetPasswordSchema,
  verifyPasswordOTPSchema,
} from "./password.schema";
/**
 * Password Reset Controller
 * Manages password reset workflow
 */
export class PasswordResetController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  // ============================================
  // REQUEST PASSWORD RESET (Forgot Password)
  // ============================================

  /**
   * Request password reset OTP
   * POST /auth/forgot-password
   * Body: { email }
   * ✅ Generates and sends OTP to email
   */
  requestPasswordReset = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(forgotPasswordSchema, req);
    const { email } = validated.body;

    const result = await this.authService.requestPasswordReset(email);

    ApiResponse.success(res, result, "Password reset OTP sent to your email");
  });

  // ============================================
  // VERIFY PASSWORD RESET OTP
  // ============================================

  /**
   * Verify password reset OTP
   * POST /auth/verify-password-otp
   * Body: { email, otp }
   * ✅ Validates OTP code
   */
  verifyPasswordOTP = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(verifyPasswordOTPSchema, req);
    const result = await this.authService.verifyPasswordOTP(
      validated.body.email,
      validated.body.otp
    );

    ApiResponse.success(res, result, "OTP verified");
  });

  // ============================================
  // RESET PASSWORD
  // ============================================

  resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(resetPasswordSchema, req);
    const result = await this.authService.resetPassword(
      validated.body.email,
      validated.body.otp,
      validated.body.newPassword
    );

    ApiResponse.success(res, result, "Password reset successfully");
  });

  // ============================================
  // RESEND PASSWORD RESET OTP
  // ============================================

  resendPasswordOTP = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(resendPasswordOTPSchema, req);
    const result = await this.authService.resendPasswordOTP(
      validated.body.email
    );

    ApiResponse.success(res, result, "OTP resent to email");
  });
}
