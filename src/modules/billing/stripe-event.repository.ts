import { BaseRepository } from "@/modules/base/base.repository";
import type { IStripeEvent } from "./billing.interface";
import { StripeEvent } from "./stripe-event.model";

export class StripeEventRepository extends BaseRepository<IStripeEvent> {
  constructor() {
    super(StripeEvent);
  }

  async findByEventId(eventId: string): Promise<IStripeEvent | null> {
    return this.model.findOne({ eventId }).exec();
  }

  async reserveProcessing(
    data: Pick<
      IStripeEvent,
      "eventId" | "type" | "livemode" | "createdAtStripe"
    >,
  ): Promise<IStripeEvent | null> {
    try {
      return await this.model.create({ ...data, status: "processing" });
    } catch (error: any) {
      if (error?.code === 11000) {
        const existing = await this.findByEventId(data.eventId);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const canRetry =
          existing?.status === "failed" ||
          (existing?.status === "processing" &&
            existing.updatedAt < tenMinutesAgo);

        if (!existing || !canRetry) {
          return null;
        }

        return this.model
          .findOneAndUpdate(
            {
              eventId: data.eventId,
              $or: [
                { status: "failed" },
                { status: "processing", updatedAt: { $lt: tenMinutesAgo } },
              ],
            },
            {
              $set: {
                status: "processing",
                type: data.type,
                livemode: data.livemode,
                createdAtStripe: data.createdAtStripe,
              },
              $unset: { lastError: "" },
            },
            { new: true },
          )
          .exec();
      }
      throw error;
    }
  }

  async markProcessed(eventId: string): Promise<IStripeEvent | null> {
    return this.model
      .findOneAndUpdate(
        { eventId },
        { $set: { status: "processed" }, $unset: { lastError: "" } },
        { new: true },
      )
      .exec();
  }

  async markFailed(
    eventId: string,
    errorMessage: string,
  ): Promise<IStripeEvent | null> {
    return this.model
      .findOneAndUpdate(
        { eventId },
        {
          $set: {
            status: "failed",
            lastError: errorMessage.slice(0, 1000),
          },
        },
        { new: true },
      )
      .exec();
  }
}
