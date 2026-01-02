// file: src/modules/auth/auth.type.ts

import type { ROLES } from "@/constants/app.constants";
import type { UserResponse } from "../user/user.type";

/**
 * Register Payload - common fields only
 */
export type RegisterPayload = {
  email: string;
  password: string;
  fullName: string;
  phoneNumber: string;
  address: string;
  role?: (typeof ROLES)["CLIENT"];
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type JWTTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
};

/**
 * Auth Service Response (UPDATED)
 * Service layer returns both tokens
 */
export type AuthServiceResponse = {
  user: UserResponse;
  tokens: JWTTokens;
};

/**
 * Auth Token Response (for API responses)
 */
export type AuthTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
};

/**
 * Auth Controller Response (NEW)
 * Controller layer returns only access token in JSON
 */
export type AuthControllerResponse = {
  user: UserResponse;
  accessToken: string; // Only access token in JSON
  expiresIn: string;
};

/**
 * Change password payload
 */
export type ChangePasswordPayload = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

/**
 * Email Verification Request
 */
export type VerifyEmailPayload = {
  email: string;
  code: string; // 4-digit OTP
};
