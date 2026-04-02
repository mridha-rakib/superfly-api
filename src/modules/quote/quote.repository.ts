import { QUOTE } from "@/constants/app.constants";
import { BaseRepository } from "@/modules/base/base.repository";
import { Types } from "mongoose";
import type { IQuote } from "./quote.interface";
import { Quote } from "./quote.model";

export class QuoteRepository extends BaseRepository<IQuote> {
  constructor() {
    super(Quote);
  }

  async findCleanerAssignments(
    cleanerIds: string[],
    excludeQuoteId?: string,
  ): Promise<IQuote[]> {
    const objectIds = Array.from(
      new Set(
        (Array.isArray(cleanerIds) ? cleanerIds : [])
          .map((id) => id?.toString().trim())
          .filter((id): id is string => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      ),
    );

    if (!objectIds.length) {
      return [];
    }

    const query: Record<string, any> = {
      isDeleted: { $ne: true },
      $or: [
        { assignedCleanerId: { $in: objectIds } },
        { assignedCleanerIds: { $in: objectIds } },
      ],
    };

    if (excludeQuoteId && Types.ObjectId.isValid(excludeQuoteId)) {
      query._id = { $ne: new Types.ObjectId(excludeQuoteId) };
    }

    return this.model
      .find(query)
      .select(
        "_id serviceType serviceDate preferredTime cleaningSchedule assignedCleanerId assignedCleanerIds",
      )
      .exec();
  }

  async softDeleteManyByIds(quoteIds: string[]): Promise<number> {
    const objectIds = Array.from(
      new Set(
        (Array.isArray(quoteIds) ? quoteIds : [])
          .map((id) => id?.toString().trim())
          .filter((id): id is string => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      ),
    );

    if (!objectIds.length) {
      return 0;
    }

    const result = await this.model
      .updateMany(
        {
          _id: { $in: objectIds },
          isDeleted: { $ne: true },
        },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        },
      )
      .exec();

    return result.modifiedCount || 0;
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

  async findQuotesForCleanerReminder(
    maxServiceDate: string,
  ): Promise<IQuote[]> {
    return this.model
      .find({
        isDeleted: { $ne: true },
        status: {
          $nin: [QUOTE.STATUSES.COMPLETED, QUOTE.STATUSES.CLOSED],
        },
        serviceDate: { $lte: maxServiceDate },
        $and: [
          {
            $or: [
              { preferredTime: { $exists: true, $ne: "" } },
              { cleaningSchedule: { $exists: true, $ne: null } },
            ],
          },
          {
            $or: [
              { assignedCleanerId: { $exists: true, $ne: null } },
              { "assignedCleanerIds.0": { $exists: true } },
            ],
          },
        ],
      })
      .select(
        "_id serviceType companyName businessAddress serviceDate preferredTime cleaningFrequency cleaningSchedule assignedCleanerId assignedCleanerIds",
      )
      .exec();
  }
}
