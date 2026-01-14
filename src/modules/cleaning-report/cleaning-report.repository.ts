import { BaseRepository } from "@/modules/base/base.repository";
import type { FilterQuery } from "mongoose";
import type { ICleaningReport } from "./cleaning-report.interface";
import { CleaningReport } from "./cleaning-report.model";

export class CleaningReportRepository extends BaseRepository<ICleaningReport> {
  constructor() {
    super(CleaningReport);
  }

  async findByQuoteId(quoteId: string): Promise<ICleaningReport | null> {
    return this.model.findOne({ quoteId }).exec();
  }

  async findByIdWithDetails(
    reportId: string
  ): Promise<ICleaningReport | null> {
    return this.model
      .findById(reportId)
      .populate([
        { path: "quoteId" },
        {
          path: "cleanerId",
          select: "fullName email phoneNumber profileImageUrl",
        },
      ])
      .exec();
  }

  async findAllWithDetails(
    filter: FilterQuery<ICleaningReport> = {},
    options: Record<string, any> = {}
  ): Promise<ICleaningReport[]> {
    return this.model
      .find(filter, null, options)
      .populate([
        { path: "quoteId" },
        {
          path: "cleanerId",
          select: "fullName email phoneNumber profileImageUrl",
        },
      ])
      .lean() as unknown as ICleaningReport[];
  }
}
