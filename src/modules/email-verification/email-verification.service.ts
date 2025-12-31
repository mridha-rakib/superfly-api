// file: src/modules/email-verification/email-verification.service.ts

/**
 * Email Verification Service
 */

import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { OTPService } from "@/services/otp.service";
import {
  BadRequestException,
  NotFoundException,
} from "@/utils/app-error.utils";
import type {
  ICreateOTPRequest,
  ICreateOTPResponse,
  IEmailVerificationOTP,
  IResendEligibility,
  IResendOTPRequest,
  IResendOTPResponse,
  IVerificationStatus,
  IVerifyOTPRequest,
  IVerifyOTPResponse,
} from "./email-verification.types";
// import { ICreateOTPResponse } from "./email-verification.interface";
import { EmailVerificationOTPRepository } from "./email-verification.repository";

/**
 * Email Verification Service
 * Manages email verification OTP lifecycle
 */
export class EmailVerificationService {
  private repository: EmailVerificationOTPRepository;
  private otpService: OTPService;
  private emailService: EmailService;

  // ============================================
  // RATE LIMITING & THROTTLING CONSTANTS
  // ============================================

  private readonly config = {
    MAX_OTP_ATTEMPTS: 100,
    MIN_RESEND_INTERVAL_SECONDS: 60,
    MAX_RESENDS_PER_HOUR: 5,
    OTP_EXPIRY_MINUTES: 5,
    OTP_LENGTH: 4,
  };
  constructor(
    config?: Partial<typeof EmailVerificationService.prototype.config>
  ) {
    this.repository = new EmailVerificationOTPRepository();
    this.emailService = new EmailService();
    this.otpService = new OTPService({
      length: 4,
      expiryMinutes: this.config.OTP_EXPIRY_MINUTES,
      allowDuplicates: false,
      trackingEnabled: true,
    });

    if (config) {
      Object.assign(this.config, config);
    }
  }

  // ============================================
  // CREATE OTP (Initial Registration)
  // ============================================

  /**
   * Create initial OTP for email verification
   *
   * @param userId - User ID
   * @param email - User email
   * @returns OTP and expiration details
   *
   * @throws BadRequestException if user already verified
   * @throws Error if OTP creation fails
  
   */
  async createOTP(request: ICreateOTPRequest): Promise<ICreateOTPResponse> {
    // Step 1: Invalidate previous OTPs for this user
    await this.repository.invalidatePreviousOTPs(request.userId);
    // Step 2: Check if already verified
    const activeOTP = await this.repository.findActiveByUserId(request.userId);
    if (activeOTP?.verified) {
      throw new BadRequestException("Email already verified for this account");
    }

    // Step 3: Generate OTP
    const otpGenerated = this.otpService.generate("EMAIL_VERIFICATION");

    // Step 4: Calculate expiration time
    const expiresAt = new Date(
      Date.now() + this.config.OTP_EXPIRY_MINUTES * 60 * 1000
    );

    // Step 5: Save OTP to database
    const record = await this.repository.createOTP({
      userId: request.userId,
      email: request.email,
      userType: request.userType,
      code: otpGenerated.code,
      expiresAt: otpGenerated.expiresAt,
      verified: false,
      attempts: 0,
      maxAttempts: this.config.MAX_OTP_ATTEMPTS,
    });

    // // Step 6: Send verification email
    // const expiresInMinutes = Math.ceil(otpGenerated.expiresInSeconds / 60);

    // Step 6: Send verification email
    await this.emailService.sendEmailVerification({
      to: request.email,
      userName: request.userName,
      userType: request.userType,
      verificationCode: String(otpGenerated.code),
      expiresIn: String(this.config.OTP_EXPIRY_MINUTES),
    });

    logger.info(
      {
        userId: request.userId,
        email: request.email,
        userType: request.userType,
        expiresAt: otpGenerated.expiresAt,
      },
      "Email verification OTP created and sent successfully"
    );

    return {
      otp: otpGenerated.code,
      code: otpGenerated.code,
      expiresAt: otpGenerated.expiresAt,
      expiresInMinutes: this.config.OTP_EXPIRY_MINUTES,
    };
  }

  /**
   * VERIFY OTP
   * ✅ Generic: works for ANY user type
   * ✅ Returns userType for flexible downstream handling
   *
   * @param request - Contains email and code
   * @returns User info and userType
   */
  async verifyOTP(request: IVerifyOTPRequest): Promise<IVerifyOTPResponse> {
    // Step 1: Find OTP by email
    const record = await this.repository.findByEmail(request.email);
    if (!record) {
      throw new NotFoundException("Verification code not found or expired");
    }

    // Step 2: Check max attempts
    if (record.attempts >= this.config.MAX_OTP_ATTEMPTS) {
      throw new BadRequestException(
        "Maximum verification attempts exceeded. Please request a new code."
      );
    }

    // Step 3: Validate OTP code
    const isValidCode = await this.validateOTPCode(
      request.code,
      record.code,
      record.expiresAt
    );

    if (!isValidCode) {
      // Increment failed attempts
      await this.repository.incrementAttempts(record._id!.toString());

      logger.warn(
        {
          email: request.email,
          attempts: record.attempts + 1,
          userType: record.userType,
        },
        "OTP verification failed - invalid code"
      );

      throw new BadRequestException("Invalid verification code");
    }

    // Step 4: Mark as verified
    await this.repository.markAsVerified(record._id!.toString());

    logger.info(
      {
        userId: record.userId,
        email: request.email,
        userType: record.userType,
      },
      "Email verified successfully"
    );

    return {
      userId: record.userId,
      email: record.email,
      userType: record.userType,
      verified: true,
    };
  }

  /**
   * RESEND OTP
   * @param request - Contains email and userType
   * @returns New OTP expiration details
   */
  async resendOTP(request: IResendOTPRequest): Promise<IResendOTPResponse> {
    // Step 1: Find existing OTP
    let existingOTP = await this.repository.findByEmail(
      request.email,
      request.userType
    );

    if (!existingOTP) {
      existingOTP = await this.repository.findByEmailIgnoreExpiry(
        request.email,
        request.userType
      );
    }

    if (!existingOTP) {
      throw new NotFoundException(
        "No pending verification found. Please register again."
      );
    }

    // Step 2: Check if already verified
    if (existingOTP.verified) {
      throw new BadRequestException("Email already verified for this account");
    }

    // Step 3: Check resend eligibility (rate limiting)
    const eligibility = await this.checkResendEligibility(existingOTP);
    if (!eligibility.canResend) {
      throw new BadRequestException(
        eligibility.reason ||
          "Too many resend attempts. Please try again later."
      );
    }

    // Step 4: Invalidate old OTPs
    await this.repository.invalidatePreviousOTPs(existingOTP.userId);

    // Step 5: Generate new OTP
    const newOTPGenerated = this.otpService.generate(
      "EMAIL_VERIFICATION_RESEND"
    );

    // Step 6: Save new OTP to database
    await this.repository.createOTP({
      userId: existingOTP.userId,
      email: request.email,
      userType: request.userType,
      code: newOTPGenerated.code,
      expiresAt: newOTPGenerated.expiresAt,
      verified: false,
      attempts: 0,
      maxAttempts: this.config.MAX_OTP_ATTEMPTS,
    });

    // Step 7: Send email with new OTP
    const expiresInMinutes = Math.ceil(newOTPGenerated.expiresInSeconds / 60);

    await this.emailService.resendEmailVerification({
      to: request.email,
      userName: request.userName,
      userType: request.userType,
      verificationCode: String(newOTPGenerated.code),
      expiresIn: String(expiresInMinutes),
    });

    logger.info(
      {
        userId: existingOTP.userId,
        email: request.email,
        userType: request.userType,
        resendCount: eligibility.attemptsRemaining,
      },
      "Email verification OTP resent successfully"
    );

    return {
      message: `Verification code has been resent to your email. It will expire in ${expiresInMinutes} minutes.`,
      expiresAt: newOTPGenerated.expiresAt,
      expiresInMinutes,
    };
  }
  /**
   * CHECK RESEND ELIGIBILITY
   * Rate limiting: prevent spam/abuse
   *
   * @param otpRecord - Existing OTP record
   * @returns Eligibility status with cooldown info
   */
  private async checkResendEligibility(
    otpRecord: IEmailVerificationOTP
  ): Promise<IResendEligibility> {
    const now = new Date();

    // Check 1: Minimum interval between resends
    if (otpRecord.lastAttemptAt) {
      const secondsSinceLastAttempt =
        (now.getTime() - otpRecord.lastAttemptAt.getTime()) / 1000;

      if (secondsSinceLastAttempt < this.config.MIN_RESEND_INTERVAL_SECONDS) {
        const waitSeconds = Math.ceil(
          this.config.MIN_RESEND_INTERVAL_SECONDS - secondsSinceLastAttempt
        );

        return {
          canResend: false,
          reason: `Please wait ${waitSeconds} seconds before requesting another code.`,
          nextResendTime: new Date(now.getTime() + waitSeconds * 1000),
        };
      }
    }

    // Check 2: Maximum resends per hour
    // ✅ FIX: Use repository's query instead of direct model access
    const resendCount = await this.repository.countResendAttemptsLastHour(
      otpRecord.userId,
      otpRecord.email
    );

    if (resendCount >= this.config.MAX_RESENDS_PER_HOUR) {
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      return {
        canResend: false,
        reason: "Too many resend requests. Please try again after 1 hour.",
        nextResendTime: oneHourFromNow,
        attemptsRemaining: 0,
      };
    }

    return {
      canResend: true,
      attemptsRemaining: this.config.MAX_RESENDS_PER_HOUR - resendCount,
    };
  }

  /**
   *
   * VALIDATE OTP CODE
   * Helper: validate OTP matches and is not expired
   *
   * @param providedCode - Code user provided
   * @param storedCode - Code stored in DB
   * @param expiresAt - Expiration time
   * @returns true if valid, false otherwise
   */

  private async validateOTPCode(
    providedCode: string,
    storedCode: string,
    expiresAt: Date
  ): Promise<boolean> {
    // Check 1: Has expired
    if (new Date() > expiresAt) {
      return false;
    }

    // Check 2: Code matches
    return providedCode === storedCode;
  }

  /**
   * GET VERIFICATION STATUS
   * ✅ Generic: works for any user type
   *
   * @param userId - User ID
   * @returns Current verification status
   */
  async getVerificationStatus(userId: string): Promise<IVerificationStatus> {
    const record = await this.repository.findActiveByUserId(userId);

    if (!record) {
      return {
        isVerified: false,
        pendingVerification: false,
      };
    }

    if (record.verified) {
      return {
        isVerified: true,
        pendingVerification: false,
        userType: record.userType,
      };
    }

    const expiresInMinutes = Math.ceil(
      (record.expiresAt.getTime() - new Date().getTime()) / 60000
    );

    return {
      isVerified: false,
      pendingVerification: true,
      userType: record.userType,
      expiresAt: record.expiresAt,
      expiresInMinutes: Math.max(0, expiresInMinutes),
      attempts: record.attempts,
    };
  }

  /**
   * CLEANUP EXPIRED OTPs
   * Call periodically (cron job) to delete expired records
   *
   * @returns Number of deleted records
   */
  async cleanupExpiredOTPs(): Promise<number> {
    const count = await this.repository.deleteExpiredOTPs();

    logger.info({ count }, "Expired email verification OTPs cleaned up");

    return count;
  }

  /**
   * GET OTP STATISTICS
   * For analytics/monitoring
   *
   * @param userId - User ID
   * @returns Statistics object
   */
  // async getOTPStatistics(userId: string): Promise<IOTPStatistics> {
  //   return this.repository.getStatistics(userId);
  // }

  /**
   * DELETE USER VERIFICATION DATA
   * ✅ Helper: when user account is deleted
   *
   * @param userId - User ID
   */
  async deleteUserVerificationData(userId: string): Promise<void> {
    await this.repository.deleteByUserId(userId);

    logger.info({ userId }, "User verification data deleted");
  }
}
