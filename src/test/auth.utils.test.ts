import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requiredEnv = {
  NODE_ENV: "test",
  APP_NAME: "SuperFly Test",
  BASE_URL: "/api/v1",
  PORT: "3000",
  MONGO_URI: "https://example.com",
  CLIENT_URL: "https://example.com",
  JWT_SECRET: "test-access-secret",
  JWT_REFRESH_SECRET: "test-refresh-secret",
  JWT_EXPIRY: "7d",
  JWT_REFRESH_EXPIRY: "30d",
  SALT_ROUNDS: "12",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_test_123",
  AWS_ACCESS_KEY: "test-access-key",
  AWS_SECRET_ACCESS_KEY: "test-secret-key",
  AWS_REGION: "us-east-1",
  AWS_S3_BUCKET: "test-bucket",
};

describe("AuthUtil token verification", () => {
  beforeEach(() => {
    vi.resetModules();

    for (const [key, value] of Object.entries(requiredEnv)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(requiredEnv)) {
      delete process.env[key];
    }
  });

  it("throws UnauthorizedException for invalid access tokens", async () => {
    const [
      { AuthUtil },
      { UnauthorizedException },
      { HTTPSTATUS },
      { ErrorCodeEnum },
    ] = await Promise.all([
      import("../modules/auth/auth.utils"),
      import("../utils/app-error.utils"),
      import("../config/http.config"),
      import("../enums/error-code.enum"),
    ]);

    try {
      AuthUtil.verifyAccessToken("invalid-token");
      throw new Error("Expected verifyAccessToken to throw");
    } catch (error) {
      const authError = error as {
        errorCode?: string;
        message?: string;
        statusCode?: number;
      };

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(authError.statusCode).toBe(HTTPSTATUS.UNAUTHORIZED);
      expect(authError.errorCode).toBe(ErrorCodeEnum.AUTH_TOKEN_INVALID);
      expect(authError.message).toBe("Invalid or expired access token");
    }
  });

  it("throws UnauthorizedException for invalid refresh tokens", async () => {
    const [
      { AuthUtil },
      { UnauthorizedException },
      { HTTPSTATUS },
      { ErrorCodeEnum },
    ] = await Promise.all([
      import("../modules/auth/auth.utils"),
      import("../utils/app-error.utils"),
      import("../config/http.config"),
      import("../enums/error-code.enum"),
    ]);

    try {
      AuthUtil.verifyRefreshToken("invalid-token");
      throw new Error("Expected verifyRefreshToken to throw");
    } catch (error) {
      const authError = error as {
        errorCode?: string;
        message?: string;
        statusCode?: number;
      };

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(authError.statusCode).toBe(HTTPSTATUS.UNAUTHORIZED);
      expect(authError.errorCode).toBe(ErrorCodeEnum.AUTH_TOKEN_INVALID);
      expect(authError.message).toBe("Invalid or expired refresh token.");
    }
  });
});
