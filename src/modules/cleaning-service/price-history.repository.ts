import { BaseRepository } from "@/modules/base/base.repository";
import type { ICleaningServicePriceHistory } from "./cleaning-service.interface";
import { CleaningServicePriceHistory } from "./price-history.model";

export class CleaningServicePriceHistoryRepository extends BaseRepository<ICleaningServicePriceHistory> {
  constructor() {
    super(CleaningServicePriceHistory);
  }

  async findByService(serviceId: string) {
    return this.model
      .find({ serviceId })
      .sort({ changedAt: -1 })
      .exec();
  }
}
