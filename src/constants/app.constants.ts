// file: src/constants/app.constants.ts
import { env } from "@/env";

export const APP = {
  NAME: env.APP_NAME || "Service provider platform",
  VERSION: "1.0.0",
} as const;

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  CLIENT: "client",
  CLEANER: "cleaner",
  ADMIN: "admin",
} as const;

export const ACCOUNT_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const;

export const OTP = {
  LENGTH: 4,
  EXPIRY_MINUTES: 10,
  MAX_ATTEMPTS: 100,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

export const AUTH = {
  ACCESS_TOKEN_EXPIRY: "7d",
  REFRESH_TOKEN_EXPIRY: "30d",
  EMAIL_VERIFICATION_EXPIRY_HOURS: 24,

  OTP_LENGTH: 4,
  OTP_EXPIRY_MINUTES: 10,
  OTP_MAX_ATTEMPTS: 3,

  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15,
  PASSWORD_RESET_COOLDOWN_SECONDS: 60,

  MIN_PASSWORD_LENGTH: 8,
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES: 10,
} as const;

export const QUOTE = {
  CURRENCY: "USD",
  SERVICE_TYPES: {
    RESIDENTIAL: "residential",
    COMMERCIAL: "commercial",
    POST_CONSTRUCTION: "post_construction",
  },
  STATUSES: {
    SUBMITTED: "submitted",
    ADMIN_NOTIFIED: "admin_notified",
    REVIEWED: "reviewed",
    CONTACTED: "contacted",
    PAID: "paid",
    COMPLETED: "completed",
  },
  CLEANING_STATUSES: {
    PENDING: "pending", // paid, not started
    IN_PROGRESS: "cleaning_in_progress", // on-site / ongoing
    COMPLETED: "completed", // cleaner finished work
  },
  REPORT_STATUSES: {
    PENDING: "pending",
    APPROVED: "approved",
  },
} as const;

export const MESSAGES = {
  AUTH: {
    REGISTER_SUCCESS:
      "Registration successful. Please check your email to verify your account.",
    LOGIN_SUCCESS: "Login successful.",
    UNAUTHORIZED_ACCESS: "You do not have permission to perform this action.",
    EMAIL_VERIFICATION_SENT:
      "Verification email sent. Please check your inbox.",
    EMAIL_VERIFIED_SUCCESS: "Email verified successfully. You can now login.",
    PASSWORD_RESET_OTP_SENT:
      "OTP sent to your email. It will expire in 10 minutes.",
    PASSWORD_RESET_SUCCESS: "Password reset successfully.",
    INVALID_CREDENTIALS: "Invalid email or password.",
    EMAIL_ALREADY_EXISTS: "Email already registered.",
    EMAIL_NOT_VERIFIED: "Please verify your email before login.",
    ACCOUNT_SUSPENDED: "Your account has been suspended.",
    ACCOUNT_INACTIVE: "Your account is inactive.",
    INVALID_OTP: "Invalid OTP code.",
    OTP_EXPIRED: "OTP has expired. Please request a new one.",
    OTP_MAX_ATTEMPTS:
      "Maximum OTP attempts exceeded. Please request a new one.",
    LOGOUT_SUCCESS: "Logged out successfully.",
    REFRESH_TOKEN_INVALID: "Invalid or expired refresh token.",
    VERIFICATION_CODE_SENT: "Verification code sent to your email.",
    EMAIL_ALREADY_VERIFIED: "Email is already verified.",
  },
  USER: {
    USER_NOT_FOUND: "User not found.",
    USER_CREATED: "User created successfully.",
    USER_UPDATED: "User updated successfully.",
    USER_DELETED: "User deleted successfully.",
  },
  VALIDATION: {
    INVALID_EMAIL: "Invalid email format.",
    PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
    PASSWORD_WEAK:
      "Password must contain uppercase, lowercase, numbers, and special characters.",
    REQUIRED_FIELD: "This field is required.",
  },
} as const;

export const ERRORS = {
  INTERNAL_SERVER_ERROR: "Internal server error.",
  NOT_FOUND: "Resource not found.",
  UNAUTHORIZED: "Unauthorized access.",
  FORBIDDEN: "Forbidden access.",
  BAD_REQUEST: "Bad request.",
  CONFLICT: "Resource already exists.",
} as const;
