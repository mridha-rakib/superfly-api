import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { ApiResponse } from "@/utils/response.utils";
import type { Request, Response } from "express";
import { DashboardService } from "./dashboard.service";

export class DashboardController {
  private dashboardService: DashboardService;

  constructor() {
    this.dashboardService = new DashboardService();
  }

  getOverview = asyncHandler(async (req: Request, res: Response) => {
    const data = await this.dashboardService.getOverview();
    ApiResponse.success(res, data, "Dashboard overview fetched successfully");
  });

  getEarningsAnalytics = asyncHandler(async (req: Request, res: Response) => {
    const rawPage =
      typeof req.query.page === "string"
        ? Number.parseInt(req.query.page, 10)
        : Number.NaN;
    const rawLimit =
      typeof req.query.limit === "string"
        ? Number.parseInt(req.query.limit, 10)
        : Number.NaN;

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const serviceType =
      typeof req.query.serviceType === "string"
        ? req.query.serviceType.trim()
        : undefined;

    const data = await this.dashboardService.getEarningsAnalytics({
      page,
      limit,
      search,
      serviceType,
    });

    ApiResponse.success(
      res,
      data,
      "Dashboard earnings analytics fetched successfully",
    );
  });
}
