import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requiredEnv = {
  NODE_ENV: "test",
  APP_NAME: "SuperFly Test",
  BASE_URL: "/api/v1",
  PORT: "3000",
  MONGO_URI: "https://example.com",
  CLIENT_URL: "https://superflycleaning.com",
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

describe("cors config", () => {
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

    delete process.env.ADMIN_URL;
    delete process.env.ALLOWED_ORIGINS;
  });

  it("builds a shared allowlist for website, admin, and local development", async () => {
    const { buildAllowedOrigins } = await import("../config/cors.config");

    const origins = buildAllowedOrigins({
      NODE_ENV: "development",
      CLIENT_URL: "https://superflycleaning.com",
    });

    expect(origins).toContain("https://superflycleaning.com");
    expect(origins).toContain("https://admin.superflycleaning.com");
    expect(origins).toContain("https://www.superflycleaning.com");
    expect(origins).toContain("http://localhost:5173");
    expect(origins).toContain("http://127.0.0.1:5174");
  });

  it("resolves explicit and derived production origins and rejects unknown hosts", async () => {
    const {
      buildSocketCorsOptions,
      getPreferredCorsOrigin,
      resolveCorsOrigin,
    } = await import("../config/cors.config");

    const config = {
      NODE_ENV: "production",
      CLIENT_URL: "https://superflycleaning.com",
      ADMIN_URL: "https://admin.superflycleaning.com",
      ALLOWED_ORIGINS:
        "https://partner.superflycleaning.com,https://ops.superflycleaning.com",
    };

    expect(getPreferredCorsOrigin(config)).toBe(
      "https://admin.superflycleaning.com",
    );
    expect(resolveCorsOrigin("https://admin.superflycleaning.com", config)).toBe(
      "https://admin.superflycleaning.com",
    );
    expect(resolveCorsOrigin("https://partner.superflycleaning.com", config)).toBe(
      "https://partner.superflycleaning.com",
    );
    expect(resolveCorsOrigin("https://evil.example.com", config)).toBe(false);

    expect(buildSocketCorsOptions(config).origin).toEqual(
      expect.arrayContaining([
        "https://superflycleaning.com",
        "https://admin.superflycleaning.com",
        "https://www.superflycleaning.com",
        "https://partner.superflycleaning.com",
        "https://ops.superflycleaning.com",
      ]),
    );
  });

  it("falls back to the preferred admin origin when the request has no origin", async () => {
    const { resolveCorsOrigin } = await import("../config/cors.config");

    expect(
      resolveCorsOrigin(undefined, {
        NODE_ENV: "production",
        CLIENT_URL: "https://www.superflycleaning.com",
      }),
    ).toBe("https://admin.superflycleaning.com");
  });
});
