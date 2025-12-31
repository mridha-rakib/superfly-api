// file: src/config/bootstrap.ts

import { logger } from "@/middlewares/pino-logger";
import { AdminSeeder } from "@/seeders/admin.seeder";

export async function bootstrapApplication(): Promise<void> {
  try {
    logger.info("🚀 Bootstrapping application...");
    await AdminSeeder.run();

    logger.info("✅ Application bootstrapped successfully");
  } catch (error) {
    logger.error(error, "❌ Bootstrap failed");
    throw error;
  }
}
