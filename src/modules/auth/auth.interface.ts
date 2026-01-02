// file: src/modules/auth/auth.interface.ts

export interface IRegisterRequest {
  email: string;
  password: string;
  fullName: string;
  phoneNumber: string;
  address: string;
  role?: "client";
}

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface IVerifyEmailRequest {
  email: string;
  code: string;
}

export interface IRequestPasswordResetRequest {
  email: string;
}

export interface IVerifyOTPRequest {
  email: string;
  otp: string;
}

export interface IResetPasswordRequest {
  email: string;
  otp: string;
  newPassword: string;
}

export interface IRefreshTokenRequest {
  refreshToken: string;
}

export interface IAuthResponse {
  success: boolean;
  message: string;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    user?: any;
  };
}
