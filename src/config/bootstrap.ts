// file: src/config/bootstrap.ts

import { logger } from "@/middlewares/pino-logger";
import { CleaningReport } from "@/modules/cleaning-report/cleaning-report.model";
import { quoteCleanerReminderScheduler } from "@/modules/quote/quote-cleaner-reminder.scheduler";
import { AdminSeeder } from "@/seeders/admin.seeder";

async function migrateCleaningReportIndexes(): Promise<void> {
  const indexes = await CleaningReport.collection.indexes();
  const legacyQuoteOnlyIndex = indexes.find((index) => {
    const keys = Object.keys(index.key || {});
    return (
      index.unique === true &&
      keys.length === 1 &&
      index.key?.quoteId === 1
    );
  });

  if (legacyQuoteOnlyIndex) {
    const indexName = legacyQuoteOnlyIndex.name;
    if (indexName) {
      await CleaningReport.collection.dropIndex(indexName);
      logger.info(
        { indexName },
        "Dropped legacy cleaning-report unique index"
      );
    }
  }

  await CleaningReport.syncIndexes();
}

export async function bootstrapApplication(): Promise<void> {
  try {
    logger.info("🚀 Bootstrapping application...");
    await AdminSeeder.run();
    await migrateCleaningReportIndexes();
    quoteCleanerReminderScheduler.start();

    logger.info("✅ Application bootstrapped successfully");
  } catch (error) {
    logger.error(error, "❌ Bootstrap failed");
    throw error;
  }
}
