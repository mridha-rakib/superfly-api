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
}
