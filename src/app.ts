// file: src/app.ts
import type { Application } from "express";

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { errorHandler } from "@/middlewares/error-handler.middleware";
import { notFound } from "@/middlewares/not-found.middleware";
import rootRouter from "@/routes/index.route.js";

import { env } from "./env.js";
import { pinoLogger } from "./middlewares/pino-logger.js";

const app: Application = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json());
app.use(pinoLogger());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(helmet());

app.get<object>("/", (req, res) => {
  res.json({
    message: "SuperFly-service-API",
  });
});

app.use(env.BASE_URL, rootRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
