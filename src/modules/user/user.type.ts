// file: src/modules/user/user.type.ts

import type { ACCOUNT_STATUS, ROLES } from "@/constants/app.constants";

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

export type UpdateUserPayload = {
  fullName?: string;
  phoneNumber?: string;
  phone?: string;
  address?: string;
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
