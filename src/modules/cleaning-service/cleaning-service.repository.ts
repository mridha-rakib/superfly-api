import { BaseRepository } from "@/modules/base/base.repository";
import type { FilterQuery } from "mongoose";
import type { ICleaningService } from "./cleaning-service.interface";
import { CleaningService } from "./cleaning-service.model";

export class CleaningServiceRepository extends BaseRepository<ICleaningService> {
  constructor() {
    super(CleaningService);
  }

  async findByCode(code: string): Promise<ICleaningService | null> {
    return this.model.findOne({ code, isDeleted: false }).exec();
  }

  async findActive(filter: FilterQuery<ICleaningService> = {}) {
    return this.model
      .find({ ...filter, isDeleted: false, isActive: true })
      .exec();
  }

  async findByNameAndCategory(
    nameLower: string
  ): Promise<ICleaningService | null> {
    return this.model.findOne({ nameLower, isDeleted: false }).exec();
  }

  async findByIds(ids: string[]): Promise<ICleaningService[]> {
    return this.model.find({ _id: { $in: ids }, isDeleted: false }).exec();
  }
}
