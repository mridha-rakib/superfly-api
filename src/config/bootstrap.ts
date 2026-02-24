// file: src/config/bootstrap.ts

import { logger } from "@/middlewares/pino-logger";
import { quoteCleanerReminderScheduler } from "@/modules/quote/quote-cleaner-reminder.scheduler";
import { AdminSeeder } from "@/seeders/admin.seeder";

export async function bootstrapApplication(): Promise<void> {
  try {
    logger.info("🚀 Bootstrapping application...");
    await AdminSeeder.run();
    quoteCleanerReminderScheduler.start();

    logger.info("✅ Application bootstrapped successfully");
  } catch (error) {
    logger.error(error, "❌ Bootstrap failed");
    throw error;
  }
}
