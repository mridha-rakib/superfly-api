const assert = require("node:assert/strict");

const requiredEnv = {
  NODE_ENV: "test",
  APP_NAME: "SuperFly Test",
  BASE_URL: "/api/v1",
  PORT: "3000",
  MONGO_URI: "https://example.com",
  CLIENT_URL: "https://superflycleaning.com",
  EMAIL_FROM_NAME: "Superfly Cleaning Services",
  EMAIL_FROM_ADDRESS: "info@superflycleaning.com",
  EMAIL_LOGO_URL: "https://postimg.cc/gwFVqz4F",
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

Object.assign(process.env, requiredEnv);

const { AuthUtil } = require("../dist/modules/auth/auth.utils.js");
const { buildAllowedOrigins, buildSocketCorsOptions, getPreferredCorsOrigin, resolveCorsOrigin } = require("../dist/config/cors.config.js");
const { HTTPSTATUS } = require("../dist/config/http.config.js");
const { EmailService } = require("../dist/services/email.service.js");
const { ErrorCodeEnum } = require("../dist/enums/error-code.enum.js");
const { BillingService } = require("../dist/modules/billing/billing.service.js");
const { createCheckoutSessionSchema } = require("../dist/modules/billing/billing.schema.js");
const { QuoteService } = require("../dist/modules/quote/quote.service.js");
const { UnauthorizedException } = require("../dist/utils/app-error.utils.js");

const tests = [
  {
    name: "accepts one-time billing checkout requests without recurring data",
    async run() {
      const parsed = await createCheckoutSessionSchema.parseAsync({
        body: {
          services: {
            "standard-cleaning": 1,
          },
          mode: "payment",
        },
      });

      assert.deepEqual(parsed.body.services, { "standard-cleaning": 1 });
      assert.equal(parsed.body.mode, "payment");
    },
  },
  {
    name: "triggers quote fulfillment for paid checkout webhooks",
    async run() {
      const service = Object.create(BillingService.prototype);
      const calls = [];

      service.updateFromSession = async (session, status) => {
        calls.push({ type: "update", sessionId: session.id, status });
      };
      service.fulfillQuoteCheckoutSession = async (session) => {
        calls.push({ type: "fulfill", sessionId: session.id });
      };

      await service.handleCheckoutSessionCompleted({
        id: "cs_paid",
        payment_status: "paid",
      });

      assert.deepEqual(calls, [
        { type: "update", sessionId: "cs_paid", status: "paid" },
        { type: "fulfill", sessionId: "cs_paid" },
      ]);
    },
  },
  {
    name: "does not fulfill quote for pending checkout webhooks",
    async run() {
      const service = Object.create(BillingService.prototype);
      const calls = [];

      service.updateFromSession = async (session, status) => {
        calls.push({ type: "update", sessionId: session.id, status });
      };
      service.fulfillQuoteCheckoutSession = async (session) => {
        calls.push({ type: "fulfill", sessionId: session.id });
      };

      await service.handleCheckoutSessionCompleted({
        id: "cs_pending",
        payment_status: "unpaid",
      });

      assert.deepEqual(calls, [
        { type: "update", sessionId: "cs_pending", status: "pending" },
      ]);
    },
  },
  {
    name: "quote checkout fulfillment is a no-op for untracked sessions",
    async run() {
      const service = Object.create(QuoteService.prototype);
      let confirmCalled = false;

      service.paymentDraftRepository = {
        findByStripeSessionId: async () => null,
      };
      service.confirmCheckoutSessionPayment = async () => {
        confirmCalled = true;
      };

      const result = await service.fulfillCheckoutSession("cs_untracked");

      assert.equal(result, null);
      assert.equal(confirmCalled, false);
    },
  },
  {
    name: "rejects invalid access tokens",
    run() {
      assert.throws(
        () => AuthUtil.verifyAccessToken("invalid-token"),
        (error) => {
          assert.ok(error instanceof UnauthorizedException);
          assert.equal(error.statusCode, HTTPSTATUS.UNAUTHORIZED);
          assert.equal(error.errorCode, ErrorCodeEnum.AUTH_TOKEN_INVALID);
          assert.equal(error.message, "Invalid or expired access token");
          return true;
        },
      );
    },
  },
  {
    name: "rejects invalid refresh tokens",
    run() {
      assert.throws(
        () => AuthUtil.verifyRefreshToken("invalid-token"),
        (error) => {
          assert.ok(error instanceof UnauthorizedException);
          assert.equal(error.statusCode, HTTPSTATUS.UNAUTHORIZED);
          assert.equal(error.errorCode, ErrorCodeEnum.AUTH_TOKEN_INVALID);
          assert.equal(error.message, "Invalid or expired refresh token.");
          return true;
        },
      );
    },
  },
  {
    name: "builds the expected shared CORS allowlist",
    run() {
      const origins = buildAllowedOrigins({
        NODE_ENV: "development",
        CLIENT_URL: "https://superflycleaning.com",
      });

      assert.ok(origins.includes("https://superflycleaning.com"));
      assert.ok(origins.includes("https://admin.superflycleaning.com"));
      assert.ok(origins.includes("https://www.superflycleaning.com"));
      assert.ok(origins.includes("http://localhost:5173"));
      assert.ok(origins.includes("http://127.0.0.1:5174"));
    },
  },
  {
    name: "resolves allowed production origins and rejects unknown ones",
    run() {
      const config = {
        NODE_ENV: "production",
        CLIENT_URL: "https://superflycleaning.com",
        ADMIN_URL: "https://admin.superflycleaning.com",
        ALLOWED_ORIGINS:
          "https://partner.superflycleaning.com,https://ops.superflycleaning.com",
      };

      assert.equal(
        getPreferredCorsOrigin(config),
        "https://admin.superflycleaning.com",
      );
      assert.equal(
        resolveCorsOrigin("https://admin.superflycleaning.com", config),
        "https://admin.superflycleaning.com",
      );
      assert.equal(
        resolveCorsOrigin("https://partner.superflycleaning.com", config),
        "https://partner.superflycleaning.com",
      );
      assert.equal(resolveCorsOrigin("https://evil.example.com", config), false);

      const socketOrigins = buildSocketCorsOptions(config).origin;
      assert.ok(Array.isArray(socketOrigins));
      assert.ok(socketOrigins.includes("https://superflycleaning.com"));
      assert.ok(socketOrigins.includes("https://admin.superflycleaning.com"));
      assert.ok(socketOrigins.includes("https://www.superflycleaning.com"));
      assert.ok(socketOrigins.includes("https://partner.superflycleaning.com"));
      assert.ok(socketOrigins.includes("https://ops.superflycleaning.com"));
    },
  },
  {
    name: "keeps cleaner ids when normalizing occurrence progress entries",
    run() {
      const service = Object.create(QuoteService.prototype);
      const occurrenceEntry = {
        cleaningStatus: "pending",
        reportStatus: undefined,
        paymentStatus: "pending",
        cleanerPercentage: 25,
        cleanerEarningAmount: 150,
      };

      Object.defineProperty(occurrenceEntry, "cleanerId", {
        value: "69cc531498e8d66773ab2ae5",
        enumerable: false,
        configurable: true,
      });
      Object.defineProperty(occurrenceEntry, "occurrenceDate", {
        value: "2026-04-03",
        enumerable: true,
        configurable: true,
      });

      const quote = {
        serviceType: "post_construction",
        cleanerOccurrenceProgress: [occurrenceEntry],
        totalPrice: 600,
        paymentAmount: 0,
      };

      const normalized = service.getCleanerOccurrenceProgress(quote);
      assert.equal(normalized.length, 1);
      assert.equal(normalized[0].cleanerId, "69cc531498e8d66773ab2ae5");

      const cleanerProgress = service.buildCleanerProgressFromOccurrences(
        quote,
        normalized,
      );
      assert.equal(cleanerProgress.length, 1);
      assert.equal(cleanerProgress[0].cleanerId, "69cc531498e8d66773ab2ae5");
    },
  },
  {
    name: "uses the bundled Superfly logo when EMAIL_LOGO_URL is not a direct image",
    run() {
      const service = new EmailService({
        sendMail: async () => {},
      });

      const html = service.buildVerificationTemplate(
        "Admin User",
        "admin",
        "654321",
        "10",
      );

      assert.match(
        html,
        /src="cid:superfly-cleaning-services-logo"/,
      );
      assert.ok(!html.includes('src="https://postimg.cc/gwFVqz4F"'));
    },
  },
  {
    name: "attaches the bundled Superfly logo to SMTP emails",
    async run() {
      let capturedMessage;
      const transporter = {
        async sendMail(message) {
          capturedMessage = message;
        },
      };
      const service = new EmailService(transporter);

      await service.sendSmtp({
        to: "client@example.com",
        subject: "Test email",
        html: '<html><body><img src="cid:superfly-cleaning-services-logo" /></body></html>',
        text: "Test email",
      });

      assert.ok(capturedMessage);
      assert.ok(Array.isArray(capturedMessage.attachments));
      assert.equal(capturedMessage.attachments.length, 1);
      assert.equal(
        capturedMessage.attachments[0].cid,
        "superfly-cleaning-services-logo",
      );
      assert.equal(capturedMessage.attachments[0].contentType, "image/png");
    },
  },
  {
    name: "allows cleaner assignment when same-day time slots do not overlap",
    async run() {
      const cleanerId = "69cc531498e8d66773ab2ae5";
      const service = Object.create(QuoteService.prototype);

      service.quoteRepository = {
        findCleanerAssignments: async () => [
          {
            serviceType: "commercial",
            serviceDate: "2026-04-03",
            preferredTime: "09:00",
            cleaningSchedule: {
              frequency: "one_time",
              schedule: {
                date: "2026-04-03",
                start_time: "09:00",
                end_time: "11:00",
              },
            },
            assignedCleanerId: cleanerId,
            assignedCleanerIds: [cleanerId],
          },
        ],
      };
      service.userService = {
        getById: async () => ({ fullName: "Cleaner One" }),
      };

      await service.assertCleanersAvailableForAssignment([cleanerId], {
        serviceDate: "2026-04-03",
        preferredTime: "12:00",
        cleaningSchedule: {
          frequency: "one_time",
          schedule: {
            date: "2026-04-03",
            start_time: "12:00",
            end_time: "14:00",
          },
        },
      });
    },
  },
  {
    name: "rejects cleaner assignment when same-day time slots overlap",
    async run() {
      const cleanerId = "69cc531498e8d66773ab2ae5";
      const service = Object.create(QuoteService.prototype);

      service.quoteRepository = {
        findCleanerAssignments: async () => [
          {
            serviceType: "commercial",
            serviceDate: "2026-04-03",
            preferredTime: "09:00",
            cleaningSchedule: {
              frequency: "one_time",
              schedule: {
                date: "2026-04-03",
                start_time: "09:00",
                end_time: "11:00",
              },
            },
            assignedCleanerId: cleanerId,
            assignedCleanerIds: [cleanerId],
          },
        ],
      };
      service.userService = {
        getById: async () => ({ fullName: "Cleaner One" }),
      };

      await assert.rejects(
        () =>
          service.assertCleanersAvailableForAssignment([cleanerId], {
            serviceDate: "2026-04-03",
            preferredTime: "10:00",
            cleaningSchedule: {
              frequency: "one_time",
              schedule: {
                date: "2026-04-03",
                start_time: "10:00",
                end_time: "12:00",
              },
            },
          }),
        (error) => {
          assert.equal(
            error.message,
            "Cleaner One already assigned to another booking during an overlapping time slot on 2026-04-03.",
          );
          return true;
        },
      );
    },
  },
];

(async () => {
  let failed = 0;

  for (const test of tests) {
    try {
      await test.run();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${test.name}`);
      console.error(error);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`Passed ${tests.length} test(s).`);
})();
