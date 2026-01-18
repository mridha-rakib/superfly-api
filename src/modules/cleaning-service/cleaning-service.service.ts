import {
  BadRequestException,
  NotFoundException,
} from "@/utils/app-error.utils";
import type {
  ICleaningService,
  ICleaningServicePriceHistory,
} from "./cleaning-service.interface";
import { CleaningServiceRepository } from "./cleaning-service.repository";
import type {
  CleaningServiceCreatePayload,
  CleaningServicePriceUpdatePayload,
  CleaningServiceResponse,
  CleaningServiceUpdatePayload,
  PriceHistoryResponse,
} from "./cleaning-service.type";
import { CleaningServicePriceHistoryRepository } from "./price-history.repository";

export class CleaningServiceService {
  private repository: CleaningServiceRepository;
  private historyRepository: CleaningServicePriceHistoryRepository;

  constructor() {
    this.repository = new CleaningServiceRepository();
    this.historyRepository = new CleaningServicePriceHistoryRepository();
  }

  async createService(
    payload: CleaningServiceCreatePayload
  ): Promise<CleaningServiceResponse> {
    const nameLower = payload.name.trim().toLowerCase();
    const code = await this.generateUniqueCode(payload.name);

    const existing = await this.repository.findByNameAndCategory(nameLower);

    if (existing) {
      throw new BadRequestException(
        "Service name must be unique within its category"
      );
    }

    const service = await this.repository.create({
      name: payload.name.trim(),
      nameLower,
      code,
      price: payload.price,
      isActive: true,
    });

    return this.toResponse(service);
  }

  async updateService(
    serviceId: string,
    payload: CleaningServiceUpdatePayload
  ): Promise<CleaningServiceResponse> {
    const service = await this.repository.findById(serviceId);
    if (!service) {
      throw new NotFoundException("Service not found");
    }

    if (payload.name || payload.category) {
      const nameLower = (payload.name || service.name).trim().toLowerCase();

      const existing = await this.repository.findByNameAndCategory(nameLower);

      if (existing && existing._id.toString() !== serviceId) {
        throw new BadRequestException(
          "Service name must be unique within its category"
        );
      }

      service.name = payload.name?.trim() || service.name;
      service.nameLower = nameLower;
    }

    if (payload.isActive !== undefined) {
      service.isActive = payload.isActive;
    }

    await service.save();
    return this.toResponse(service);
  }

  async updatePrice(
    serviceId: string,
    payload: CleaningServicePriceUpdatePayload,
    adminId: string
  ): Promise<CleaningServiceResponse> {
    const service = await this.repository.findById(serviceId);
    if (!service) {
      throw new NotFoundException("Service not found");
    }

    const oldPrice = service.price;
    const newPrice = payload.price;

    if (oldPrice === newPrice) {
      throw new BadRequestException(
        "New price must be different from current price"
      );
    }

    service.price = newPrice;
    await service.save();

    await this.historyRepository.create({
      serviceId: service._id,
      serviceName: service.name,
      oldPrice,
      newPrice,
      changedBy: adminId,
      changedAt: new Date(),
    });

    return this.toResponse(service);
  }

  async deleteService(serviceId: string): Promise<void> {
    const service = await this.repository.findById(serviceId);
    if (!service) {
      throw new NotFoundException("Service not found");
    }

    await this.repository.softDelete(serviceId);
  }

  async listActiveServices(): Promise<CleaningServiceResponse[]> {
    const services = await this.repository.findActive();
    return services.map((service) => this.toResponse(service));
  }

  async listAllServices(): Promise<CleaningServiceResponse[]> {
    const services = await this.repository.find({ isDeleted: false });
    return services.map((service) => this.toResponse(service));
  }

  async getPriceHistory(serviceId?: string): Promise<PriceHistoryResponse[]> {
    const records = serviceId
      ? await this.historyRepository.findByService(serviceId)
      : await this.historyRepository.find({}, { sort: { changedAt: -1 } });

    return records.map((record) => this.toHistoryResponse(record));
  }

  async getActiveServicesByCodes(codes: string[]): Promise<ICleaningService[]> {
    if (codes.length === 0) {
      return this.repository.findActive();
    }

    const services = await this.repository.findActive({ code: { $in: codes } });
    return services;
  }

  private toResponse(service: ICleaningService): CleaningServiceResponse {
    return {
      _id: service._id.toString(),
      name: service.name,
      code: service.code,
      price: service.price,
      isActive: service.isActive,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
  }

  private toHistoryResponse(
    record: ICleaningServicePriceHistory
  ): PriceHistoryResponse {
    return {
      _id: record._id.toString(),
      serviceId: record.serviceId.toString(),
      serviceName: record.serviceName,
      oldPrice: record.oldPrice,
      newPrice: record.newPrice,
      changedBy: record.changedBy.toString(),
      changedAt: record.changedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async generateUniqueCode(baseName: string): Promise<string> {
    const normalized = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .substring(0, 48);

    let candidate = normalized || "service";
    let suffix = 1;

    while (await this.repository.findByCode(candidate)) {
      candidate = `${normalized}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
