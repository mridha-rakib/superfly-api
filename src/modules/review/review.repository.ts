import { BaseRepository } from "@/modules/base/base.repository";
import type { FilterQuery } from "mongoose";
import type { IReview } from "./review.interface";
import { Review } from "./review.model";

export class ReviewRepository extends BaseRepository<IReview> {
  constructor() {
    super(Review);
  }

  async findByQuoteId(quoteId: string): Promise<IReview | null> {
    return this.model.findOne({ quoteId }).exec();
  }

  async findMany(
    filter: FilterQuery<IReview> = {},
    options: Record<string, any> = {}
  ): Promise<IReview[]> {
    return this.model
      .find(filter, null, options)
      .sort({ createdAt: -1 })
      .lean() as unknown as IReview[];
  }
}
