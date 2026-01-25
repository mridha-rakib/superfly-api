// file: src/modules/user/user.service.ts (ENHANCED VERSION)

import { EMAIL_ENABLED } from "@/config/email.config";
import { env } from "@/env";
import {
  ACCOUNT_STATUS,
  MESSAGES,
  PAGINATION,
  ROLES,
} from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { s3Service, type StorageUploadInput } from "@/services/s3.service";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@/utils/app-error.utils";
import { generateRandomPassword, hashPassword } from "@/utils/password.utils";
import type { IUser } from "./user.interface";
import { UserRepository } from "./user.repository";
import type {
  CleanerCreatePayload,
  CleanerCreationResult,
  PaginationQuery,
  UserCreatePayload,
  UserResponse,
} from "./user.type";

export class UserService {
  private userRepository: UserRepository;
  private emailService: EmailService;

  constructor() {
    this.userRepository = new UserRepository();
    this.emailService = new EmailService();
  }

  toUserResponse(user: IUser): UserResponse {
    return {
      _id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      phone: user.phoneNumber || "",
      address: user.address,
      role: user.role,
      accountStatus: user.accountStatus,
      emailVerified: user.emailVerified,
      cleanerPercentage: user.cleanerPercentage,
      lastLoginAt: user.lastLoginAt,
      profileImage: user.profileImageUrl || undefined,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  getUserResponse(user: IUser): UserResponse {
    return this.toUserResponse(user);
  }

  async updateProfilePhoto(
    userId: string,
    file: StorageUploadInput,
  ): Promise<UserResponse> {
    if (!file || !file.buffer) {
      throw new BadRequestException("Profile photo file is required");
    }

    if (!file.mimeType?.startsWith("image/")) {
      throw new BadRequestException("Profile photo must be an image");
    }

    const upload = await s3Service.uploadFile(file, {
      prefix: `profiles/${userId}`,
    });

    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    user.profileImageUrl = upload.url;
    await user.save();

    return this.toUserResponse(user);
  }

  async listCleaners(query: PaginationQuery) {
    const page = query.page ? Number(query.page) : PAGINATION.DEFAULT_PAGE;
    const limit = query.limit ? Number(query.limit) : PAGINATION.DEFAULT_LIMIT;

    const filter: Record<string, any> = {
      role: ROLES.CLEANER,
    };

    if (query.status) {
      filter.accountStatus = query.status;
    }

    if (query.search) {
      const pattern = new RegExp(query.search, "i");
      filter.$or = [
        { fullName: { $regex: pattern } },
        { email: { $regex: pattern } },
      ];
    }

    const result = await this.userRepository.paginate(filter, {
      page,
      limit,
      sort: { createdAt: -1 },
      select: "-password",
    });

    return {
      data: (result.data || []).map((user) => this.toUserResponse(user as any)),
      pagination: {
        currentPage: result.currentPage,
        totalPages: result.pageCount,
        totalItems: result.totalItems,
        itemsPerPage: result.itemsPerPage,
        hasNext: result.hasNext,
        hasPrev: result.hasPrev,
        nextPage: result.nextPage,
        prevPage: result.prevPage,
        slNo: result.slNo,
      },
    };
  }

  async getCleanerById(cleanerId: string): Promise<UserResponse> {
    const cleaner = await this.userRepository.findOne({
      _id: cleanerId,
      role: ROLES.CLEANER,
      isDeleted: false,
    });

    if (!cleaner) {
      throw new NotFoundException("Cleaner not found");
    }

    return this.toUserResponse(cleaner);
  }

  async getUsersByIds(ids: string[]): Promise<UserResponse[]> {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean))).map(String);
    if (!uniqueIds.length) return [];

    const users = await this.userRepository.find({
      _id: { $in: uniqueIds },
      isDeleted: { $ne: true },
    });

    return users.map((user) => this.toUserResponse(user as any));
  }

  async createUser(payload: UserCreatePayload): Promise<IUser> {
    const existing = await this.userRepository.findByEmail(payload.email);
    if (existing) {
      throw new ConflictException(MESSAGES.AUTH.EMAIL_ALREADY_EXISTS);
    }

    const hashedPassword = payload.password
      ? await hashPassword(payload.password)
      : undefined;

    return this.userRepository.create({
      email: payload.email.toLowerCase(),
      password: hashedPassword,
      fullName: payload.fullName,
      phoneNumber: payload.phoneNumber || payload.phone,
      address: payload.address,
      role: payload.role,
      emailVerified: payload.emailVerified ?? false,
      accountStatus: payload.accountStatus ?? ACCOUNT_STATUS.PENDING,
      cleanerPercentage: payload.role === ROLES.CLEANER
        ? payload.cleanerPercentage
        : undefined,
    });
  }

  async createCleaner(
    payload: CleanerCreatePayload
  ): Promise<CleanerCreationResult> {
    const email = payload.email.toLowerCase();
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new ConflictException(MESSAGES.AUTH.EMAIL_ALREADY_EXISTS);
    }

    if (
      Number.isNaN(payload.cleanerPercentage) ||
      payload.cleanerPercentage < 0 ||
      payload.cleanerPercentage > 100
    ) {
      throw new BadRequestException("Cleaner percentage must be 0-100");
    }

    const tempPassword = generateRandomPassword();
    const hashedPassword = await hashPassword(tempPassword);

    const cleaner = await this.userRepository.create({
      email,
      password: hashedPassword,
      fullName: payload.fullName,
      phoneNumber: payload.phoneNumber,
      address: payload.address || "N/A",
      role: ROLES.CLEANER,
      emailVerified: true,
      accountStatus: ACCOUNT_STATUS.ACTIVE,
      mustChangePassword: true,
      passwordAutoGenerated: true,
      cleanerPercentage: payload.cleanerPercentage,
    });

    const emailSendingEnabled = EMAIL_ENABLED && env.NODE_ENV !== "test";
    let emailSent = false;
    let emailWarning: string | undefined = emailSendingEnabled
      ? undefined
      : "Cleaner created, but email delivery is disabled. Share the credentials manually.";
    try {
      await this.emailService.sendAccountCredentials({
        to: cleaner.email,
        userName: cleaner.fullName,
        userType: cleaner.role,
        password: tempPassword,
      });
      emailSent = emailSendingEnabled;
    } catch (error) {
      emailSent = false;
      emailWarning =
        "Cleaner created, but sending login credentials via email failed.";
      logger.warn(
        { email: cleaner.email, error },
        "Failed to send cleaner credentials email"
      );
    }

    return {
      cleaner: this.toUserResponse(cleaner),
      emailSent,
      emailWarning,
      temporaryPassword: emailSent ? undefined : tempPassword,
    };
  }

  async updateCleaner(
    cleanerId: string,
    payload: Partial<CleanerCreatePayload> & { accountStatus?: string }
  ): Promise<UserResponse> {
    const cleaner = await this.userRepository.findOne({
      _id: cleanerId,
      role: ROLES.CLEANER,
      isDeleted: false,
    });

    if (!cleaner) {
      throw new NotFoundException("Cleaner not found");
    }

    if (payload.email) {
      const newEmail = payload.email.toLowerCase();
      if (newEmail !== cleaner.email) {
        const existing = await this.userRepository.findByEmail(newEmail);
        if (existing && existing._id.toString() !== cleanerId) {
          throw new ConflictException(MESSAGES.AUTH.EMAIL_ALREADY_EXISTS);
        }
        cleaner.email = newEmail;
      }
    }

    if (payload.fullName) {
      cleaner.fullName = payload.fullName.trim();
    }

    if (payload.phoneNumber !== undefined) {
      cleaner.phoneNumber = payload.phoneNumber;
    }

    if (payload.address !== undefined) {
      cleaner.address = payload.address;
    }

    if (payload.cleanerPercentage !== undefined) {
      if (
        Number.isNaN(payload.cleanerPercentage) ||
        payload.cleanerPercentage < 0 ||
        payload.cleanerPercentage > 100
      ) {
        throw new BadRequestException("Cleaner percentage must be 0-100");
      }
      cleaner.cleanerPercentage = payload.cleanerPercentage;
    }

    if (payload.accountStatus) {
      cleaner.accountStatus = payload.accountStatus as (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];
    }

    await cleaner.save();
    return this.toUserResponse(cleaner);
  }

  async deleteCleaner(cleanerId: string): Promise<void> {
    const cleaner = await this.userRepository.findOne({
      _id: cleanerId,
      role: ROLES.CLEANER,
      isDeleted: false,
    });

    if (!cleaner) {
      throw new NotFoundException("Cleaner not found");
    }

    await this.userRepository.softDelete(cleanerId);
  }

  async getUserByEmail(email: string): Promise<IUser | null> {
    return this.userRepository.findByEmail(email);
  }

  async getUserByEmailWithPassword(email: string): Promise<IUser | null> {
    return this.userRepository.findByEmailWithPassword(email);
  }

  async getById(userId: string): Promise<IUser | null> {
    return this.userRepository.findById(userId);
  }

  async getUserByIdWithPassword(userId: string): Promise<IUser | null> {
    return this.userRepository.findByIdWithPassword(userId);
  }

  async markEmailAsVerified(userId: string): Promise<IUser | null> {
    return this.userRepository.markEmailAsVerified(userId);
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.userRepository.updatePassword(userId, hashedPassword);
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.userRepository.updateLastLogin(userId);
  }

  async invalidateAllRefreshTokens(userId: string): Promise<void> {
    await this.userRepository.deleteAllRefreshTokens(userId);
  }

  async notifyPasswordChange(
    email: string,
    fullName: string,
    changedAt: Date
  ): Promise<void> {
    try {
      await this.emailService.sendPasswordChangeNotification({
        to: email,
        userName: fullName,
        changedAt,
      });
    } catch (error) {
      logger.warn({ email, error }, "Password change notification failed");
    }
  }

  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException(MESSAGES.USER.USER_NOT_FOUND);
    }

    return this.toUserResponse(user);
  }

  async updateProfile(
    userId: string,
    payload: {
      fullName?: string;
      email?: string;
      phoneNumber?: string;
      address?: string;
      profileImageUrl?: string;
    }
  ): Promise<UserResponse> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new NotFoundException(MESSAGES.USER.USER_NOT_FOUND);
    }

    if (payload.email) {
      const newEmail = payload.email.toLowerCase();
      if (newEmail !== user.email) {
        const existing = await this.userRepository.findByEmail(newEmail);
        if (existing && existing._id.toString() !== userId) {
          throw new ConflictException(MESSAGES.AUTH.EMAIL_ALREADY_EXISTS);
        }
        user.email = newEmail;
        // Optional: mark as unverified on email change
        user.emailVerified = false;
      }
    }

    if (payload.fullName) {
      user.fullName = payload.fullName.trim();
    }

    if (payload.phoneNumber !== undefined) {
      user.phoneNumber = payload.phoneNumber;
    }

    if (payload.address !== undefined) {
      user.address = payload.address;
    }

    if (payload.profileImageUrl !== undefined) {
      user.profileImageUrl = payload.profileImageUrl || null;
    }

    await user.save();
    return this.toUserResponse(user);
  }
}
