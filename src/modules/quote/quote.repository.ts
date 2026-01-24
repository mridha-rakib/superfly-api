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
            $or: [
              { assignedCleanerId: new Types.ObjectId(cleanerId) },
              { assignedCleanerIds: new Types.ObjectId(cleanerId) },
            ],
            serviceType: QUOTE.SERVICE_TYPES.RESIDENTIAL,
            reportStatus: QUOTE.REPORT_STATUSES.APPROVED,
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $cond: [
                  { $ifNull: ["$assignedCleanerIds", false] },
                  {
                    $divide: [
                      { $ifNull: ["$cleanerEarningAmount", 0] },
                      {
                        $max: [
                          { $size: { $ifNull: ["$assignedCleanerIds", []] } },
                          1,
                        ],
                      },
                    ],
                  },
                  { $ifNull: ["$cleanerEarningAmount", 0] },
                ],
              },
            },
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

  async findByPaymentIntentId(paymentIntentId: string): Promise<IQuote | null> {
    return this.model.findOne({ paymentIntentId }).exec();
  }
}
