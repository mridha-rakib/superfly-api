import { BaseRepository } from "@/modules/base/base.repository";
import type {
  IQuoteCleanerReminder,
  QuoteCleanerReminderCreatePayload,
  QuoteCleanerReminderLookup,
} from "./quote-cleaner-reminder.interface";
import { QuoteCleanerReminder } from "./quote-cleaner-reminder.model";

export class QuoteCleanerReminderRepository extends BaseRepository<IQuoteCleanerReminder> {
  constructor() {
    super(QuoteCleanerReminder);
  }

  async hasSent(payload: QuoteCleanerReminderLookup): Promise<boolean> {
    const existing = await this.model.exists(payload).exec();
    return Boolean(existing);
  }

  async createOnce(payload: QuoteCleanerReminderCreatePayload): Promise<void> {
    const filter = {
      quoteId: payload.quoteId,
      cleanerId: payload.cleanerId,
      occurrenceStartAt: payload.occurrenceStartAt,
      reminderType: payload.reminderType,
    };

    await this.model
      .updateOne(filter, { $setOnInsert: payload }, { upsert: true })
      .exec();
  }
}
