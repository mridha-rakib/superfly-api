// file: src/modules/auth/auth.service.ts

import {
  ACCOUNT_STATUS,
  AUTH,
  MESSAGES,
  ROLES,
} from "@/constants/app.constants";
import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@/utils/app-error.utils";
import { comparePassword, hashPassword } from "@/utils/password.utils";
import { EmailVerificationService } from "../email-verification/email-verification.service";
import {
  IResendOTPRequest,
  UserType,
} from "../email-verification/email-verification.types";
import { PasswordResetService } from "../password/password.service";
import type { IUser } from "../user/user.interface";
import { UserService } from "../user/user.service";
import type { UserResponse } from "../user/user.type";
import type {
  AuthServiceResponse,
  LoginPayload,
  RegisterPayload,
  VerifyEmailPayload,
} from "./auth.type";
import { AuthUtil } from "./auth.utils";

export class AuthService {
  private userService: UserService;
  private passwordResetService: PasswordResetService;
  private emailVerificationService: EmailVerificationService;
  private emailService: EmailService;

  constructor() {
    this.userService = new UserService();
    this.passwordResetService = new PasswordResetService();
    this.emailService = new EmailService();
    this.emailVerificationService = new EmailVerificationService();
  }

  /**
   * Login user (All roles: Admin, Cleaner, Client)
   */
  async login(payload: LoginPayload): Promise<AuthServiceResponse> {
    const user = await this.userService.getUserByEmailWithPassword(
      payload.email,
    );

    if (!user) {
      throw new UnauthorizedException(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException(MESSAGES.AUTH.EMAIL_NOT_VERIFIED);
    }

    if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
      throw new UnauthorizedException(MESSAGES.AUTH.ACCOUNT_SUSPENDED);
    }

    if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
      throw new UnauthorizedException(MESSAGES.AUTH.ACCOUNT_INACTIVE);
    }

    // Verify password
    if (!user.password) {
      throw new UnauthorizedException(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    const isPasswordValid = await comparePassword(
      payload.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    // Update last login
    await this.userService.updateLastLogin(user._id.toString());

    // Generate tokens
    const tokens = this.generateTokens(user);

    return {
      user: this.userService.toUserResponse(user),
      tokens,
    };
  }

  /**
   * Register user (Admin, Cleaner, Client)
   */
  async register(payload: RegisterPayload): Promise<{
    user: UserResponse;
    verification: { expiresAt: Date; expiresInMinutes: number };
  }> {
    if (payload.role && payload.role !== ROLES.CLIENT) {
      throw new BadRequestException("Only clients can register");
    }

    const user = await this.userService.createUser({
      email: payload.email,
      password: payload.password,
      fullName: payload.fullName,
      phoneNumber: payload.phoneNumber,
      address: payload.address,
      role: ROLES.CLIENT,
      emailVerified: false,
      accountStatus: ACCOUNT_STATUS.PENDING,
    });

    const verification = await this.emailVerificationService.createOTP({
      userId: user._id.toString(),
      email: user.email,
      userType: user.role as UserType,
      userName: user.fullName,
    });

    return {
      user: this.userService.toUserResponse(user),
      verification: {
        expiresAt: verification.expiresAt,
        expiresInMinutes: verification.expiresInMinutes,
      },
    };
  }

  /**
   * Verify email
   */
  async verifyEmail(payload: VerifyEmailPayload): Promise<{ message: string }> {
    const result = await this.emailVerificationService.verifyOTP({
      email: payload.email,
      code: payload.code,
    });

    const user = await this.userService.getUserByEmail(payload.email);
    if (!user) {
      throw new NotFoundException(MESSAGES.USER.USER_NOT_FOUND);
    }

    await this.userService.markEmailAsVerified(result.userId);

    logger.info(
      { userId: result.userId, userType: result.userType },
      "Email verified and user marked",
    );

    await this.emailService.sendWelcomeEmail({
      to: user.email,
      userName: user.fullName,
      userType: result.userType,
      loginLink: `${env.CLIENT_URL}/login`,
    });

    return { message: MESSAGES.AUTH.EMAIL_VERIFIED_SUCCESS };
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(
    email: string,
  ): Promise<{ message: string; expiresAt?: Date; expiresInMinutes?: number }> {
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      return { message: MESSAGES.AUTH.PASSWORD_RESET_OTP_SENT };
    }

    // Step 2: Generate OTP using password reset service
    const result = await this.passwordResetService.requestPasswordReset(
      user._id.toString(),
      user.email,
      user.fullName,
    );

    logger.info(
      { userId: user._id, email: user.email },
      "Password reset requested",
    );

    return result;
  }

  /**
   * Verify password reset OTP
   */
  async verifyPasswordOTP(
    email: string,
    otp: string,
  ): Promise<{ message: string }> {
    // Step 1: Find user
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    // Step 2: Verify OTP
    const result = await this.passwordResetService.verifyOTP(
      user._id.toString(),
      otp,
    );

    logger.info({ userId: user._id, email }, "Password reset OTP verified");

    return result;
  }

  /**
   * Verify OTP
   */
  async verifyOTP(email: string, otp: string): Promise<{ message: string }> {
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    // ✅ FIXED: Use PasswordResetService.verifyOTP() which handles all logic
    return this.passwordResetService.verifyOTP(user._id.toString(), otp);
  }

  /**
   * Reset password with OTP
   */
  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    // Step 1: Find user
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    // Step 2: Verify OTP again (double check)
    await this.passwordResetService.verifyOTP(user._id.toString(), otp);

    // Step 3: Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Step 4: Update user password
    await this.userService.updatePassword(user._id.toString(), hashedPassword);

    // Step 5: Mark OTP as used
    await this.passwordResetService.markOTPAsUsed(user._id.toString());

    // Step 6: Clean up all reset OTPs for this user
    await this.passwordResetService.deleteUserOTPs(user._id.toString());

    // Step 7: Send security notification email
    await this.emailService.sendPasswordResetConfirmation(
      user.fullName,
      user.email,
    );

    logger.info(
      { userId: user._id, email },
      "Password reset successfully completed",
    );

    // Step 8: Log out user from all devices (invalidate all tokens)
    // This is optional - you can skip if not implemented yet
    // await this.authTokenService.revokeAllTokensForUser(user._id.toString());

    return {
      message:
        "Password reset successfully. Please log in with your new password.",
    };
  }

  /**
   * Resend password reset OTP
   */
  async resendPasswordOTP(
    email: string,
  ): Promise<{ message: string; expiresAt?: Date; expiresInMinutes?: number }> {
    const user = await this.userService.getUserByEmail(email);

    if (!user) {
      return {
        message:
          "If an account exists, a password reset code will be sent to the email address",
      };
    }

    const result = await this.passwordResetService.requestPasswordReset(
      user._id.toString(),
      user.email,
      user.fullName,
    );

    logger.info({ userId: user._id, email }, "Password reset OTP resent");

    return result;
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string }> {
    let payload: { userId?: string; exp?: number } | null = null;

    try {
      payload = AuthUtil.verifyRefreshToken(refreshToken);

      const isTokenRevoked =
        await this.userService.isRefreshTokenRevoked(refreshToken);
      if (isTokenRevoked) {
        throw new UnauthorizedException(MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
      }

      if (!payload.userId) {
        throw new UnauthorizedException(MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
      }

      const user = await this.userService.getById(payload.userId);

      if (!user) {
        await this.revokeRefreshToken(refreshToken, payload, "admin_action");
        throw new UnauthorizedException(MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
      }

      if (!user.emailVerified) {
        await this.revokeRefreshToken(
          refreshToken,
          payload,
          "security_incident",
        );
        throw new UnauthorizedException(MESSAGES.AUTH.EMAIL_NOT_VERIFIED);
      }

      if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) {
        await this.revokeRefreshToken(
          refreshToken,
          payload,
          "security_incident",
        );
        throw new UnauthorizedException(MESSAGES.AUTH.ACCOUNT_SUSPENDED);
      }

      if (user.accountStatus !== ACCOUNT_STATUS.ACTIVE) {
        await this.revokeRefreshToken(
          refreshToken,
          payload,
          "security_incident",
        );
        throw new UnauthorizedException(MESSAGES.AUTH.ACCOUNT_INACTIVE);
      }

      const accessToken = AuthUtil.generateAccessToken({
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        emailVerified: user.emailVerified,
      });

      return { accessToken };
    } catch (error) {
      if (payload?.userId) {
        await this.revokeRefreshToken(refreshToken, payload, "admin_action");
      }
      throw new UnauthorizedException(MESSAGES.AUTH.REFRESH_TOKEN_INVALID);
    }
  }

  /**
   * Generate JWT tokens
   */
  private generateTokens(user: IUser): {
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
  } {
    const accessToken = AuthUtil.generateAccessToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
    });

    const refreshToken = AuthUtil.generateRefreshToken(user._id.toString());

    return {
      accessToken,
      refreshToken,
      expiresIn: AUTH.ACCESS_TOKEN_EXPIRY,
    };
  }

  private async revokeRefreshToken(
    token: string,
    payload?: { userId?: string; exp?: number } | null,
    reason: "logout" | "password_change" | "security_incident" | "admin_action" = "admin_action",
  ): Promise<void> {
    if (!payload?.userId || !token) return;

    const expiresAt = payload.exp
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    try {
      await this.userService.blacklistRefreshToken({
        userId: payload.userId,
        token,
        expiresAt,
        reason,
      });
    } catch (error) {
      logger.warn(
        { userId: payload.userId, error },
        "Failed to blacklist refresh token",
      );
    }
  }

  /**
   * Resend verification code
   */
  async resendVerificationCode(
    request: Partial<IResendOTPRequest>,
  ): Promise<{ message: string }> {
    // Find user first
    const user = await this.userService.getUserByEmail(request.email!);

    if (!user) {
      return {
        message: "If an account exists, a verification code will be sent",
      };
    }

    if (user.emailVerified) {
      throw new BadRequestException("Email already verified");
    }

    // Step 3: Get userType (from request or user.role)
    const userType = (request.userType || user.role) as UserType;
    const userName = request.userName || user.fullName;

    // Step 4: Call email verification service to resend OTP
    const result = await this.emailVerificationService.resendOTP({
      email: request.email!,
      userType,
      userName,
    });

    logger.info(
      {
        email: request.email,
        userType,
        userId: user._id,
      },
      "Verification code resend initiated",
    );

    return { message: result.message };
  }

  /**
   * Logout user (clear tokens and sessions)
   *  Required by auth controller
   */
  async logout(token: string, userId: string): Promise<{ message: string }> {
    try {
      logger.info(
        { userId, token: token.substring(0, 20) + "..." },
        "User logged out",
      );

      // [TODO]:
      // Optional: Add token blacklist logic here if implemented
      // await this.authTokenService.revokeToken(token);

      return { message: "Logged out successfully" };
    } catch (error) {
      logger.error({ error, userId }, "Logout failed");
      throw new BadRequestException("Logout failed");
    }
  }

  /**
   * Change password for authenticated user
   */

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    // Step 1: Get user by ID (including password field)
    const user = await this.userService.getUserByIdWithPassword(userId);

    if (!user) {
      throw new NotFoundException(MESSAGES.USER.USER_NOT_FOUND);
    }

    // Step 2: Verify current password matches
    const isPasswordValid = await comparePassword(
      currentPassword,
      user.password!,
    );

    if (!isPasswordValid) {
      logger.warn(
        { userId },
        "Invalid current password attempt for password change",
      );
      throw new UnauthorizedException("Current password is incorrect");
    }

    // Step 3: Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Step 4: Update user password in database
    await this.userService.updatePassword(userId, hashedPassword);

    // Step 5: Invalidate all refresh tokens (force re-login everywhere)
    await this.userService.invalidateAllRefreshTokens(userId);

    // Step 6: Send password change confirmation email
    await this.userService.notifyPasswordChange(
      user.email,
      user.fullName,
      new Date(),
    );

    logger.info({ userId, email: user.email }, "Password changed successfully");

    return {
      message:
        "Password changed successfully. Please login again with your new password.",
    };
  }
}
