// file: src/index.ts
import app from "@/app";
import { connectDB } from "@/config/database.config";
import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
import { realtimeService } from "@/services/realtime.service";
import { bootstrapApplication } from "./config/bootstrap";

const port = env.PORT;

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught Exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled Rejection");
  process.exit(1);
});

function handleServerError(err: NodeJS.ErrnoException): void {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${env.PORT} is already in use. Please choose another port or stop the process using it.`,
    );
  } else {
    console.error("Failed to start server:", err);
  }

  process.exit(1);
}

async function startServer(): Promise<void> {
  try {
    await connectDB();
    await bootstrapApplication();

    const server = app.listen(port, () => {
      realtimeService.initialize(server);
      logger.info(`Listening: http://localhost:${port}`);
    });

    server.on("error", handleServerError);
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start application");
    process.exit(1);
  }
}

void startServer();
