// file: src/modules/user/user.type.ts

import type { ACCOUNT_STATUS, ROLES } from "@/constants/app.constants";
import type { PaginationQuery as BasePaginationQuery } from "@/ts/pagination.types";

export type UserResponse = {
  _id: string;
  email: string;
  fullName: string;
  phone: string;
  address: string;
  role: (typeof ROLES)[keyof typeof ROLES];
  accountStatus: (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];
  emailVerified: boolean;
  cleanerPercentage?: number;
  lastLoginAt?: Date;
  profileImage?: string;

  createdAt: Date;
  updatedAt: Date;
};

export type UserCreatePayload = {
  email: string;
  password?: string;
  fullName: string;
  phoneNumber: string;
  phone?: string;
  address: string;
  role: (typeof ROLES)[keyof typeof ROLES];
  emailVerified?: boolean;
  accountStatus?: (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];
  cleanerPercentage?: number;
};

export type CleanerCreatePayload = {
  fullName: string;
  email: string;
  cleanerPercentage: number;
  phoneNumber?: string;
  address?: string;
};

export type CleanerCreationResult = {
  cleaner: UserResponse;
  emailSent: boolean;
  emailWarning?: string;
  /**
   * Only returned when email delivery fails so admins can share credentials manually.
   */
  temporaryPassword?: string;
};

export type PaginationQuery = BasePaginationQuery;

export type UpdateUserPayload = {
  fullName?: string;
  phoneNumber?: string;
  phone?: string;
  address?: string;
  email?: string;
  profileImageUrl?: string;
};

export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
};

export type JWTPayload = {
  userId: string;
  email: string;
  role: string;
  accountStatus: string;
  emailVerified?: boolean;
  iat?: number;
  exp?: number;
};
