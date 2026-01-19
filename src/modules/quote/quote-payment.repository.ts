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

  async updateByStripeSessionId(
    stripeSessionId: string,
    update: Partial<IQuotePaymentDraft>,
  ): Promise<IQuotePaymentDraft | null> {
    return this.model
      .findOneAndUpdate({ stripeSessionId }, update, { new: true })
      .exec();
  }

  async updateByPaymentIntentId(
    paymentIntentId: string,
    update: Partial<IQuotePaymentDraft>,
  ): Promise<IQuotePaymentDraft | null> {
    return this.model
      .findOneAndUpdate({ paymentIntentId }, update, { new: true })
      .exec();
  }
}
