import { BaseRepository } from "@/modules/base/base.repository";
import { QuotePaymentDraft } from "./quote-payment.model";
import type { IQuotePaymentDraft } from "./quote.interface";

export class QuotePaymentDraftRepository extends BaseRepository<IQuotePaymentDraft> {
  constructor() {
    super(QuotePaymentDraft);
  }

  async findByPaymentIntentId(
    paymentIntentId: string,
  ): Promise<IQuotePaymentDraft | null> {
    return this.model.findOne({ paymentIntentId }).exec();
  }

  async findByStripeSessionId(
    stripeSessionId: string,
  ): Promise<IQuotePaymentDraft | null> {
    return this.model.findOne({ stripeSessionId }).exec();
  }
}
