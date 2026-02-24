import { logger } from "@/middlewares/pino-logger";
import cron, { type ScheduledTask } from "node-cron";
import { QuoteCleanerReminderService } from "./quote-cleaner-reminder.service";

class QuoteCleanerReminderScheduler {
  private readonly cronExpression = "* * * * *";
  private readonly reminderService: QuoteCleanerReminderService;
  private task?: ScheduledTask;
  private isRunning = false;

  constructor() {
    this.reminderService = new QuoteCleanerReminderService();
  }

  start(): void {
    if (this.task) {
      return;
    }

    this.task = cron.schedule(this.cronExpression, () => {
      void this.run();
    });

    logger.info(
      { cronExpression: this.cronExpression },
      "Cleaner reminder scheduler started",
    );

    void this.run();
  }

  private async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Cleaner reminder run skipped because a previous run is active");
      return;
    }

    this.isRunning = true;

    try {
      const result = await this.reminderService.processDueReminders();
      if (result.sent > 0 || result.failed > 0) {
        logger.info(result, "Cleaner reminder run completed");
      } else {
        logger.debug(result, "Cleaner reminder run completed with no deliveries");
      }
    } catch (error) {
      logger.error({ error }, "Cleaner reminder run failed");
    } finally {
      this.isRunning = false;
    }
  }
}

export const quoteCleanerReminderScheduler = new QuoteCleanerReminderScheduler();
