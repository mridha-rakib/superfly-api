// file: src/modules/password-reset/password-reset.service.ts

/**
 * Password Reset Service
 * ✅ Complete OTP lifecycle management
 * ✅ Integration with OTPService for generation
 * ✅ Rate limiting and security checks
 * ✅ Full error handling
 */

import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { OTPService } from "@/services/otp.service";
import { BadRequestException } from "@/utils/app-error.utils";
import { PasswordResetOTPRepository } from "./password.repository";
import type { IPasswordResetOTP } from "./password.interface";

/**
 * Password Reset Service
 * Handles OTP creation, verification, and cleanup
 */
export class PasswordResetService {
  private repository: PasswordResetOTPRepository;
  private otpService: OTPService;
  private emailService: EmailService;

  private readonly config = {
    MAX_OTP_ATTEMPTS: 10,
    MIN_RESEND_INTERVAL_SECONDS: 60,
    MAX_REQUESTS_PER_HOUR: 10,
    OTP_EXPIRY_MINUTES: 10,
    OTP_LENGTH: 4,
  };

  constructor() {
    this.repository = new PasswordResetOTPRepository();
    this.emailService = new EmailService();
    this.otpService = new OTPService({
      length: 4,
      expiryMinutes: this.config.OTP_EXPIRY_MINUTES,
      allowDuplicates: false,
      trackingEnabled: true,
    });
  }

  // ============================================
  // REQUEST PASSWORD RESET (Generate OTP)
  // ============================================

  /**
   * Request password reset OTP
   *
   * @param userId - User ID
   * @returns Success message and OTP expiration
   */
  async requestPasswordReset(
    userId: string,
    email: string,
    userName: string | undefined
  ): Promise<{ message: string; expiresAt: Date; expiresInMinutes: number }> {
    // Step 1: Check rate limiting (max 10 requests per hour)
    const attemptCount =
      await this.repository.countPasswordResetAttemptsLastHour(userId);

    if (attemptCount >= this.config.MAX_REQUESTS_PER_HOUR) {
      throw new BadRequestException(
        "Too many password reset requests. Please try again after 1 hour."
      );
    }

    // Step 2: Invalidate any previous active OTPs
    await this.repository.invalidatePreviousOTPs(userId);

    // Step 3: Generate new OTP
    const otpGenerated = this.otpService.generate("PASSWORD_RESET");

    // Step 4: Save OTP to database
    await this.repository.createOTP(
      userId,
      String(otpGenerated.code),
      otpGenerated.expiresAt
    );

    // Step 5: Send email with OTP
    const expiresInMinutes = Math.ceil(otpGenerated.expiresInSeconds / 60);

    await this.emailService.sendPasswordResetOTP(
      userName,
      email,
      String(otpGenerated.code),
      expiresInMinutes
    );

    logger.info(
      {
        userId,
        email,
        expiresAt: otpGenerated.expiresAt,
      },
      "Password reset OTP requested"
    );

    return {
      message: `A password reset code has been sent to your email. It will expire in ${expiresInMinutes} minutes.`,
      expiresAt: otpGenerated.expiresAt,
      expiresInMinutes,
    };
  }

  // ============================================
  // VERIFY PASSWORD RESET OTP
  // ============================================

  /**
   * Verify password reset OTP
   * ✅ ENHANCED: Complete verification logic
   *
   * @param userId - User ID
   * @param otp - OTP code provided by user
   * @returns Success message if OTP is valid
   */
  async verifyOTP(userId: string, otp: string): Promise<{ message: string }> {
    // Step 1: Find active OTP
    const passwordReset = await this.repository.findActiveOTP(userId);

    if (!passwordReset) {
      throw new BadRequestException(
        "No active password reset request found. Please request a new one."
      );
    }

    // Step 2: Check if max attempts exceeded
    if (passwordReset.attempts >= this.config.MAX_OTP_ATTEMPTS) {
      logger.warn(
        { userId, attempts: passwordReset.attempts },
        "Max password reset OTP attempts exceeded"
      );

      throw new BadRequestException(
        `Maximum verification attempts exceeded (${this.config.MAX_OTP_ATTEMPTS}). Please request a new code.`
      );
    }

    // Step 3: Check if OTP matches
    if (passwordReset.otp !== otp) {
      // Increment attempts
      await this.repository.incrementAttempts(passwordReset._id!.toString());

      logger.warn(
        {
          userId,
          attempts: passwordReset.attempts + 1,
        },
        "Invalid password reset OTP attempted"
      );

      throw new BadRequestException("Invalid password reset code");
    }

    logger.info({ userId }, "Password reset OTP verified successfully");

    return { message: "OTP verified successfully" };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Mark OTP as used after successful password reset
   * ✅ NEW: Separate method for clarity
   *
   * @param userId - User ID
   * @returns OTP ID that was marked as used
   */
  async markOTPAsUsed(userId: string): Promise<string | null> {
    const activeOTP = await this.repository.findActiveOTP(userId);

    if (!activeOTP) {
      return null;
    }

    const result = await this.repository.markAsUsed(activeOTP._id!.toString());

    if (result) {
      logger.info({ userId }, "Password reset OTP marked as used");
      return result._id!.toString();
    }

    return null;
  }

  /**
   * Get active OTP for user
   *
   * @param userId - User ID
   * @returns Active OTP or null
   */
  async findActiveOTP(userId: string): Promise<IPasswordResetOTP | null> {
    return this.repository.findActiveOTP(userId);
  }

  /**
   * Delete all OTPs for user
   * (after successful password reset)
   *
   * @param userId - User ID
   */
  async deleteUserOTPs(userId: string): Promise<void> {
    await this.repository.deleteUserOTPs(userId);
    logger.info({ userId }, "User password reset OTPs deleted");
  }

  /**
   * Check if user has active OTP
   *
   * @param userId - User ID
   * @returns True if active OTP exists
   */
  async hasActiveOTP(userId: string): Promise<boolean> {
    const count = await this.repository.countActiveOTPs(userId);
    return count > 0;
  }

  /**
   * Get OTP time remaining
   *
   * @param userId - User ID
   * @returns Seconds remaining or null if no active OTP
   */
  async getOTPTimeRemaining(userId: string): Promise<number | null> {
    const otp = await this.repository.findActiveOTP(userId);

    if (!otp) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(otp.expiresAt);
    const timeRemaining = expiresAt.getTime() - now.getTime();

    return timeRemaining > 0 ? Math.ceil(timeRemaining / 1000) : 0; // seconds
  }

  /**
   * Cleanup expired OTPs
   * (can be called by cron job)
   *
   * @returns Deleted count
   */
  async cleanupExpiredOTPs(): Promise<number> {
    const count = await this.repository.deleteExpiredOTPs();
    logger.info({ count }, "Expired password reset OTPs cleaned up");
    return count;
  }
}
