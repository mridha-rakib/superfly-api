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
  ): Promise<{
    totalEarning: number;
    paidAmount: number;
    pendingAmount: number;
    totalJobs: number;
  }> {
    const results = await this.model
      .aggregate([
        {
          $match: {
            $or: [
              { assignedCleanerId: new Types.ObjectId(cleanerId) },
              { assignedCleanerIds: new Types.ObjectId(cleanerId) },
            ],
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            totalEarning: { $sum: { $ifNull: ["$cleanerEarningAmount", 0] } },
            paidAmount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$reportSubmittedBy", false] },
                      { $eq: ["$reportStatus", QUOTE.REPORT_STATUSES.APPROVED] },
                    ],
                  },
                  { $ifNull: ["$cleanerEarningAmount", 0] },
                  0,
                ],
              },
            },
            pendingAmount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$reportSubmittedBy", false] },
                      {
                        $ne: ["$reportStatus", QUOTE.REPORT_STATUSES.APPROVED],
                      },
                    ],
                  },
                  { $ifNull: ["$cleanerEarningAmount", 0] },
                  0,
                ],
              },
            },
            totalJobs: { $sum: 1 },
          },
        },
      ])
      .exec();

    if (!results.length) {
      return { totalEarning: 0, paidAmount: 0, pendingAmount: 0, totalJobs: 0 };
    }

    const { totalEarning, paidAmount, pendingAmount, totalJobs } = results[0];

    return {
      totalEarning: totalEarning || 0,
      paidAmount: paidAmount || 0,
      pendingAmount: pendingAmount || 0,
      totalJobs: totalJobs || 0,
    };
  }

  async findByPaymentIntentId(paymentIntentId: string): Promise<IQuote | null> {
    return this.model.findOne({ paymentIntentId }).exec();
  }

  async findManualQuotesForCleanerReminder(
    maxServiceDate: string,
  ): Promise<IQuote[]> {
    return this.model
      .find({
        serviceType: {
          $in: [
            QUOTE.SERVICE_TYPES.COMMERCIAL,
            QUOTE.SERVICE_TYPES.POST_CONSTRUCTION,
          ],
        },
        isDeleted: { $ne: true },
        status: {
          $nin: [QUOTE.STATUSES.COMPLETED, QUOTE.STATUSES.CLOSED],
        },
        serviceDate: { $lte: maxServiceDate },
        preferredTime: { $exists: true, $ne: "" },
        $or: [
          { assignedCleanerId: { $exists: true, $ne: null } },
          { "assignedCleanerIds.0": { $exists: true } },
        ],
      })
      .select(
        "_id serviceType companyName businessAddress serviceDate preferredTime cleaningFrequency assignedCleanerId assignedCleanerIds",
      )
      .exec();
  }
}
