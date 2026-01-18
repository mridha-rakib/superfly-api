import { BaseRepository } from "@/modules/base/base.repository";
import type { IStripeEvent } from "./billing.interface";
import { StripeEvent } from "./stripe-event.model";

export class StripeEventRepository extends BaseRepository<IStripeEvent> {
  constructor() {
    super(StripeEvent);
  }

  async createOnce(
    data: Pick<
      IStripeEvent,
      "eventId" | "type" | "livemode" | "createdAtStripe"
    >,
  ): Promise<IStripeEvent | null> {
    try {
      return await this.model.create(data);
    } catch (error: any) {
      if (error?.code === 11000) {
        return null;
      }
      throw error;
    }
  }
}
