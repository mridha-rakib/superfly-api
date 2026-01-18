import { BaseRepository } from "@/modules/base/base.repository";
import type { IBillingPayment } from "./billing.interface";
import { BillingPayment } from "./billing.model";

export class BillingPaymentRepository extends BaseRepository<IBillingPayment> {
  constructor() {
    super(BillingPayment);
  }

  async findBySessionId(sessionId: string): Promise<IBillingPayment | null> {
    return this.model.findOne({ stripeSessionId: sessionId }).exec();
  }

  async findByInternalOrderId(
    internalOrderId: string,
  ): Promise<IBillingPayment | null> {
    return this.model.findOne({ internalOrderId }).exec();
  }

  async updateBySessionId(
    sessionId: string,
    update: Partial<IBillingPayment>,
  ): Promise<IBillingPayment | null> {
    return this.model
      .findOneAndUpdate({ stripeSessionId: sessionId }, update, { new: true })
      .exec();
  }

  async updateByPaymentIntentId(
    paymentIntentId: string,
    update: Partial<IBillingPayment>,
  ): Promise<IBillingPayment | null> {
    return this.model
      .findOneAndUpdate({ paymentIntentId }, update, { new: true })
      .exec();
  }
}
