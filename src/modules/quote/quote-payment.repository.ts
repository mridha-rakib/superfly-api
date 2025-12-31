import { BaseRepository } from "@/modules/base/base.repository";
import type { IQuotePaymentDraft } from "./quote.interface";
import { QuotePaymentDraft } from "./quote-payment.model";

export class QuotePaymentDraftRepository extends BaseRepository<IQuotePaymentDraft> {
  constructor() {
    super(QuotePaymentDraft);
  }

  async findByPaymentIntentId(
    paymentIntentId: string
  ): Promise<IQuotePaymentDraft | null> {
    return this.model.findOne({ paymentIntentId }).exec();
  }
}
