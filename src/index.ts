// file: src/index.ts
import app from "@/app";
import { connectDB } from "@/config/database.config";
import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
import { bootstrapApplication } from "./config/bootstrap";

const port = env.PORT;
const server = app.listen(port, async () => {
  await connectDB();
  await bootstrapApplication();
  logger.info(`Listening: http://localhost:${port}`);
});

server.on("error", (err) => {
  if ("code" in err && err.code === "EADDRINUSE") {
    console.error(
      `Port ${env.PORT} is already in use. Please choose another port or stop the process using it.`
    );
  } else {
    console.error("Failed to start server:", err);
  }

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught Exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled Rejection");
    process.exit(1);
  });

  process.exit(1);
});
