// file: src/app.ts
import type { Application } from "express";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { errorHandler } from "@/middlewares/error-handler.middleware";
import { notFound } from "@/middlewares/not-found.middleware";
import billingWebhookRouter from "@/modules/billing/billing-webhook.route.js";
import rootRouter from "@/routes/index.route.js";

import swaggerUi from "swagger-ui-express";

import { swaggerSpec, swaggerUiOptions } from "./config/swagger.config.js";
import { env } from "./env.js";
import { pinoLogger } from "./middlewares/pino-logger.js";

const app: Application = express();

// app.use(
//   cors({
//     origin: true,
//     credentials: true,
//   }),
// );

const allowedOrigins = new Set([
  env.CLIENT_URL,
  "https://superflycleaning.com",
  "https://www.superflycleaning.com",
  "https://admin.superflycleaning.com",
  "http://localhost:5173",
  "http://localhost:5174/",
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
  }),
);

app.use(
  `${env.BASE_URL}/billing/webhook`,
  express.raw({ type: "application/json" }),
  billingWebhookRouter,
);

app.use(express.json());
app.use(pinoLogger());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(helmet());

app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    ...swaggerUiOptions,
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: "alpha",
      operationsSorter: "method",
    },
  }),
);

app.get<object>("/", (req, res) => {
  res.json({
    message: "SuperFly-service-API",
  });
});

app.use(env.BASE_URL, rootRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
