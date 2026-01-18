import { QUOTE } from "@/constants/app.constants";
import { BaseRepository } from "@/modules/base/base.repository";
import { Types } from "mongoose";
import type { IQuote } from "./quote.interface";
import { Quote } from "./quote.model";

export class QuoteRepository extends BaseRepository<IQuote> {
  constructor() {
    super(Quote);
  }

  async sumCleanerEarnings(
    cleanerId: string
  ): Promise<{ total: number; count: number }> {
    const results = await this.model
      .aggregate([
        {
          $match: {
            assignedCleanerId: new Types.ObjectId(cleanerId),
            serviceType: QUOTE.SERVICE_TYPES.RESIDENTIAL,
            reportStatus: QUOTE.REPORT_STATUSES.APPROVED,
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ["$cleanerEarningAmount", 0] } },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();

    if (!results.length) {
      return { total: 0, count: 0 };
    }

    return {
      total: results[0].total || 0,
      count: results[0].count || 0,
    };
  }
}
