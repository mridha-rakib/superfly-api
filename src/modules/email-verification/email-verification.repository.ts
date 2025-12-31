// file: src/modules/email-verification/email-verification.repository.ts

/**
 * Email Verification Repository
 * ✅ Handle all email verification OTP operations in database
 * ✅ Type-safe with full TypeScript support
 * ✅ Clean separation of concerns
 */
import { logger } from "@/middlewares/pino-logger";
import { BaseRepository } from "@/modules/base/base.repository";
import { EmailVerificationOTP } from "./email-verification.model";
import type { IEmailVerificationOTP } from "./email-verification.types";

/**
 * Email Verification OTP Repository
 */
export class EmailVerificationOTPRepository extends BaseRepository<IEmailVerificationOTP> {
  constructor() {
    super(EmailVerificationOTP);
  }

  /**
   * Create new email verification OTP record
   * @param userId - User ID
   * @param email - User email
   * @param code - OTP code
   * @param expiresAt - Expiration time
   * @returns Created document
  
   */
  async createOTP(
    data: Partial<IEmailVerificationOTP>
  ): Promise<IEmailVerificationOTP> {
    const record = await EmailVerificationOTP.create({
      userId: data.userId,
      email: data.email,
      userType: data.userType,
      code: data.code,
      expiresAt: data.expiresAt,
      verified: data.verified ?? false,
      attempts: data.attempts ?? 0,
      maxAttempts: data.maxAttempts ?? 100,
      lastAttemptAt: data.lastAttemptAt,
    });

    logger.debug(
      {
        userId: data.userId,
        email: data.email,
        expiresAt: data.expiresAt,
      },
      "Email verification OTP created"
    );

    return record;
  }

  /**
   * Find active (non-verified) OTP for user
   * ✅ FIXED: Return null if not found (instead of undefined)
   *
   * @param userId - User ID
   * @returns OTP record or null
   */
  async findActiveByUserId(
    userId: string
  ): Promise<IEmailVerificationOTP | null> {
    const record = await EmailVerificationOTP.findOne({
      userId,
      verified: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    return record || null;
  }

  /**
   * Find OTP by email
   * ✅ FIXED: Return null if not found
   *
   * @param email - User email
   * @returns OTP record or null
   */
  async findByEmail(
    email: string,
    userType?: string
  ): Promise<IEmailVerificationOTP | null> {
    const query: any = {
      email,
      verified: false,
      expiresAt: { $gt: new Date() },
    };

    if (userType) {
      query.userType = userType;
    }

    if (userType) {
      console.log("With userType:", userType);
    }

    const record = await EmailVerificationOTP.findOne(query).sort({
      createdAt: -1,
    });

    return record || null;
  }

  async findByEmailIgnoreExpiry(
    email: string,
    userType?: string
  ): Promise<IEmailVerificationOTP | null> {
    const query: any = {
      email,
      verified: false,
      // ✅ REMOVED: expiresAt filter - allows expired OTPs
    };

    if (userType) {
      query.userType = userType;
    }

    const record = await EmailVerificationOTP.findOne(query).sort({
      createdAt: -1,
    });

    return record || null;
  }

  /**
   * Find OTP by code and email
   * ✅ FIXED: Return null if not found
   *
   * @param code - OTP code
   * @param email - User email
   * @returns OTP record or null
   */
  async findByCode(
    code: string,
    email: string
  ): Promise<IEmailVerificationOTP | null> {
    const record = await EmailVerificationOTP.findOne({
      code,
      email,
      verified: false,
      expiresAt: { $gt: new Date() },
    });

    return record || null;
  }

  /**
   * Mark OTP as verified
   * ✅ FIXED: Use proper update syntax
   *
   * @param id - OTP document ID
   * @returns Updated document
   */
  async markAsVerified(id: string): Promise<IEmailVerificationOTP | null> {
    const record = await EmailVerificationOTP.findByIdAndUpdate(
      id,
      {
        verified: true,
        verifiedAt: new Date(),
      },
      { new: true }
    );

    if (record) {
      logger.debug({ id }, "Email verification OTP marked as verified");
    }

    return record || null;
  }

  /**
   * Increment failed attempt count
   * ✅ FIXED: Use proper MongoDB update syntax with $inc
   *
   * @param id - OTP document ID
   * @returns Updated document
   */
  async incrementAttempts(id: string): Promise<IEmailVerificationOTP | null> {
    const record = await EmailVerificationOTP.findByIdAndUpdate(
      id,
      {
        $inc: { attempts: 1 },
        lastAttemptAt: new Date(),
      },
      { new: true }
    );

    return record || null;
  }

  /**
   * Invalidate previous OTPs for user (for resend flow)
   * ✅ FIXED: Use proper MongoDB query syntax
   *
   * @param userId - User ID
   * @returns Number of records invalidated
   */
  async invalidatePreviousOTPs(userId: string): Promise<number> {
    const result = await EmailVerificationOTP.updateMany(
      {
        userId,
        verified: false,
      },
      {
        $set: {
          verified: true,
          verifiedAt: new Date(),
        },
      }
    );

    logger.debug(
      {
        userId,
        count: result.modifiedCount,
      },
      "Previous OTPs invalidated"
    );

    return result.modifiedCount || 0;
  }

  /**
   * Count resend attempts in last hour
   * ✅ NEW: For rate limiting
   *
   * @param userId - User ID
   * @param email - User email
   * @returns Count of resend attempts in last hour
   */
  async countResendAttemptsLastHour(
    userId: string,
    email: string
  ): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const count = await EmailVerificationOTP.countDocuments({
      userId,
      email,
      createdAt: { $gte: oneHourAgo },
    });

    return count || 0;
  }

  /**
   * Delete by user ID (for account deletion)
   * ✅ NEW: Helper for user cleanup
   *
   * @param userId - User ID
   * @returns Number of deleted records
   */
  async deleteByUserId(userId: string): Promise<number> {
    const result = await EmailVerificationOTP.deleteMany({ userId });
    return result.deletedCount || 0;
  }

  /**
   * Delete expired OTPs (cleanup operation)
   * ✅ FIXED: Proper error handling
   *
   * @returns Number of records deleted
   */
  async deleteExpiredOTPs(): Promise<number> {
    const result = await EmailVerificationOTP.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    logger.debug({ count: result.deletedCount }, "Expired OTPs deleted");

    return result.deletedCount || 0;
  }
  /**
   * Get OTP statistics for user
   * ✅ FIXED: Proper aggregation pipeline
   *
   * @param userId - User ID
   * @returns Statistics object
   */
  // async getStatistics(userId: string): Promise<IOTPStatistics> {
  //   const now = new Date();

  //   const totalOTPs = await EmailVerificationOTP.countDocuments({ userId });

  //   const activeOTPs = await EmailVerificationOTP.countDocuments({
  //     userId,
  //     verified: false,
  //     expiresAt: { $gt: now },
  //   });

  //   const verifiedOTPs = await EmailVerificationOTP.countDocuments({
  //     userId,
  //     verified: true,
  //   });

  //   const failedAttemptsResult = await EmailVerificationOTP.aggregate([
  //     { $match: { userId } },
  //     { $group: { _id: null, totalAttempts: { $sum: "$attempts" } } },
  //   ]);

  //   const failedAttempts = failedAttemptsResult?.totalAttempts || 0;

  //   const averageAttemptsPerOTP =
  //     totalOTPs > 0 ? Math.round((failedAttempts / totalOTPs) * 100) / 100 : 0;
  //   return {
  //     totalOTPs,
  //     activeOTPs,
  //     verifiedOTPs,
  //     failedAttempts: failedAttemptsResult[0]?.totalAttempts || 0,
  //     averageAttemptsPerOTP,
  //   };
  // }
}
