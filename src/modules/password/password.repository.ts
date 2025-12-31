// file: src/modules/password-reset/password-reset.repository.ts

import { logger } from "@/middlewares/pino-logger";
import { BaseRepository } from "@/modules/base/base.repository";
import { PasswordResetOTP } from "./password.model";
import type { IPasswordResetOTP } from "./password.interface";

/**
 * Password Reset OTP Repository
 * Extends BaseRepository for data access
 */
export class PasswordResetOTPRepository extends BaseRepository<IPasswordResetOTP> {
  constructor() {
    super(PasswordResetOTP);
  }

  /**
   * Create new password reset OTP
   * ✅ FIXED: Proper typing
   *
   * @param userId - User ID
   * @param otp - OTP code
   * @param expiresAt - Expiration time
   * @returns Created OTP document
   */
  async createOTP(
    userId: string,
    otp: string,
    expiresAt: Date
  ): Promise<IPasswordResetOTP> {
    const record = await PasswordResetOTP.create({
      userId,
      otp,
      expiresAt,
      attempts: 0,
      isUsed: false,
    });

    logger.debug({ userId, expiresAt }, "Password reset OTP created");

    return record;
  }

  // ============================================
  // READ OPERATIONS
  // ============================================

  /**
   * Find active (not used & not expired) OTP for user
   * ✅ FIXED: Proper return type
   *
   * @param userId - User ID
   * @returns OTP record or null
   */
  async findActiveOTP(userId: string): Promise<IPasswordResetOTP | null> {
    const record = await PasswordResetOTP.findOne({
      userId,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .exec();

    return record || null;
  }

  /**
   * Find all OTPs for user (including used/expired)
   * ✅ FIXED: Proper return type
   *
   * @param userId - User ID
   * @returns Array of OTP records
   */
  async findAllOTPsByUser(userId: string): Promise<IPasswordResetOTP[]> {
    const records = await PasswordResetOTP.find({ userId })
      .sort({ createdAt: -1 })
      .exec();

    return records || [];
  }

  /**
   * Find OTP by ID
   * ✅ FIXED: Proper return type
   *
   * @param otpId - OTP ID
   * @returns OTP record or null
   */
  async findOTPById(otpId: string): Promise<IPasswordResetOTP | null> {
    const record = await PasswordResetOTP.findById(otpId).exec();
    return record || null;
  }

  // ============================================
  // UPDATE OPERATIONS
  // ============================================

  /**
   * Increment failed OTP attempts
   * ✅ FIXED: Use proper MongoDB $inc operator
   *
   * @param otpId - OTP ID
   * @returns Updated OTP document
   */
  async incrementAttempts(otpId: string): Promise<IPasswordResetOTP | null> {
    const record = await PasswordResetOTP.findByIdAndUpdate(
      otpId,
      {
        $inc: { attempts: 1 },
      },
      { new: true }
    ).exec();

    return record || null;
  }

  /**
   * Mark OTP as used after successful password reset
   * ✅ FIXED: Use proper MongoDB $set operator
   *
   * @param otpId - OTP ID
   * @returns Updated OTP document
   */
  async markAsUsed(otpId: string): Promise<IPasswordResetOTP | null> {
    const record = await PasswordResetOTP.findByIdAndUpdate(
      otpId,
      {
        $set: {
          isUsed: true,
          usedAt: new Date(),
        },
      },
      { new: true }
    ).exec();

    if (record) {
      logger.debug({ otpId }, "OTP marked as used");
    }

    return record || null;
  }

  /**
   * Invalidate all previous OTPs for user
   * (when requesting new OTP)
   *
   * @param userId - User ID
   * @returns Result with modified count
   */
  async invalidatePreviousOTPs(userId: string): Promise<number> {
    const result = await PasswordResetOTP.updateMany(
      {
        userId,
        isUsed: false,
      },
      {
        $set: {
          isUsed: true,
          usedAt: new Date(),
        },
      }
    ).exec();

    logger.debug(
      { userId, count: result.modifiedCount },
      "Previous password reset OTPs invalidated"
    );

    return result.modifiedCount || 0;
  }

  // ============================================
  // DELETE OPERATIONS
  // ============================================

  /**
   * Delete expired OTPs (manual cleanup)
   * Note: MongoDB TTL index handles auto-delete
   *
   * @returns Deleted count
   */
  async deleteExpiredOTPs(): Promise<number> {
    const result = await PasswordResetOTP.deleteMany({
      expiresAt: { $lt: new Date() },
    }).exec();

    logger.debug(
      { count: result.deletedCount },
      "Expired password reset OTPs deleted"
    );

    return result.deletedCount || 0;
  }

  /**
   * Delete all OTPs for user
   * (after successful password reset)
   *
   * @param userId - User ID
   * @returns Deleted count
   */
  async deleteUserOTPs(userId: string): Promise<number> {
    const result = await PasswordResetOTP.deleteMany({ userId }).exec();

    logger.debug(
      { userId, count: result.deletedCount },
      "User password reset OTPs deleted"
    );

    return result.deletedCount || 0;
  }

  // ============================================
  // COUNT OPERATIONS
  // ============================================

  /**
   * Count active OTPs for user
   *
   * @param userId - User ID
   * @returns Count of active OTPs
   */
  async countActiveOTPs(userId: string): Promise<number> {
    const count = await PasswordResetOTP.countDocuments({
      userId,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).exec();

    return count || 0;
  }

  /**
   * Count password reset attempts in last hour
   * (for rate limiting)
   *
   * @param userId - User ID
   * @returns Count of OTPs created in last hour
   */
  async countPasswordResetAttemptsLastHour(userId: string): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const count = await PasswordResetOTP.countDocuments({
      userId,
      createdAt: { $gte: oneHourAgo },
    }).exec();

    return count || 0;
  }
}
