import { MESSAGES } from "@/constants/app.constants";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import {
  createCleaningServiceSchema,
  updateCleaningServicePriceSchema,
  updateCleaningServiceSchema,
} from "./cleaning-service.schema";
import { CleaningServiceService } from "./cleaning-service.service";

export class CleaningServiceController {
  private service: CleaningServiceService;

  constructor() {
    this.service = new CleaningServiceService();
  }

  createService = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(createCleaningServiceSchema, req);
    const result = await this.service.createService(validated.body);
    ApiResponse.created(res, result, "Service created successfully");
  });

  updateService = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(updateCleaningServiceSchema, req);
    const result = await this.service.updateService(
      req.params.serviceId,
      validated.body
    );
    ApiResponse.success(res, result, "Service updated successfully");
  });

  updatePrice = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(updateCleaningServicePriceSchema, req);
    const adminId = req.user?.userId;
    if (!adminId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }
    const result = await this.service.updatePrice(
      req.params.serviceId,
      validated.body,
      adminId
    );
    ApiResponse.success(res, result, "Service price updated successfully");
  });

  deleteService = asyncHandler(async (req: Request, res: Response) => {
    await this.service.deleteService(req.params.serviceId);
    ApiResponse.success(res, { message: "Service deleted successfully" });
  });

  listActive = asyncHandler(async (_req: Request, res: Response) => {
    const result = await this.service.listActiveServices();
    ApiResponse.success(res, result, "Services fetched successfully");
  });

  listAll = asyncHandler(async (_req: Request, res: Response) => {
    const result = await this.service.listAllServices();
    ApiResponse.success(res, result, "Services fetched successfully");
  });

  listPriceHistory = asyncHandler(async (req: Request, res: Response) => {
    const result = await this.service.getPriceHistory(
      req.query.serviceId as string | undefined
    );
    ApiResponse.success(res, result, "Price history fetched successfully");
  });
}
