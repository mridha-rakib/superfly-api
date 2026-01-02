import { BaseRepository } from "@/modules/base/base.repository";
import type {
  IQuoteNotification,
  QuoteNotificationCreatePayload,
} from "./quote-notification.interface";
import { QuoteNotification } from "./quote-notification.model";

export class QuoteNotificationRepository extends BaseRepository<IQuoteNotification> {
  constructor() {
    super(QuoteNotification);
  }

  async createOnce(
    payload: QuoteNotificationCreatePayload
  ): Promise<IQuoteNotification> {
    try {
      return await this.model
        .findOneAndUpdate(
          { quoteId: payload.quoteId, event: payload.event },
          { $setOnInsert: payload },
          { new: true, upsert: true }
        )
        .exec();
    } catch (error) {
      const isDuplicate =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000;

      if (isDuplicate) {
        const existing = await this.model
          .findOne({ quoteId: payload.quoteId, event: payload.event })
          .exec();
        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }
}
