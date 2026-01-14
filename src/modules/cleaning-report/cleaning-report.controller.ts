import { MESSAGES } from "@/constants/app.constants";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import type { StorageUploadInput } from "@/services/s3.service";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { PaginationHelper } from "@/utils/pagination-helper";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import {
  createCleaningReportSchema,
  reportDetailSchema,
} from "./cleaning-report.schema";
import { CleaningReportService } from "./cleaning-report.service";

export class CleaningReportController {
  private reportService: CleaningReportService;

  constructor() {
    this.reportService = new CleaningReportService();
  }

  createReport = asyncHandler(async (req: Request, res: Response) => {
    const cleanerId = req.user?.userId;
    if (!cleanerId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }

    const fileMap = req.files as Record<string, Express.Multer.File[]> | null;
    const beforeFiles = this.mapFiles(fileMap?.beforePhotos);
    const afterFiles = this.mapFiles(fileMap?.afterPhotos);

    const validated = await zParse(createCleaningReportSchema, req);
    const report = await this.reportService.createReport(
      validated.params.quoteId,
      cleanerId,
      validated.body,
      {
        beforeFiles,
        afterFiles,
      }
    );

    ApiResponse.created(res, report, "Report submitted successfully");
  });

  listAdminReports = asyncHandler(async (req: Request, res: Response) => {
    const searchFields = ["notes"];

    if (req.query.page || req.query.limit) {
      const paginateOptions = PaginationHelper.parsePaginationParams(req.query);
      const filter = PaginationHelper.createSearchFilter(
        req.query,
        searchFields
      );
      const result = await this.reportService.getPaginated(
        filter,
        paginateOptions
      );
      const response = PaginationHelper.formatResponse({
        ...result,
        data: result.data.map((report) =>
          this.reportService.toAdminResponse(report as any)
        ),
      });

      return ApiResponse.paginated(
        res,
        response.data,
        response.pagination,
        "Reports fetched successfully"
      );
    }

    const filter = PaginationHelper.createSearchFilter(req.query, searchFields);
    const reports = await this.reportService.getAll(filter);
    const data = reports.map((report) =>
      this.reportService.toAdminResponse(report as any)
    );
    ApiResponse.success(res, data, "Reports fetched successfully");
  });

  getReportById = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(reportDetailSchema, req);
    const report = await this.reportService.getById(validated.params.reportId);
    const response = this.reportService.toAdminResponse(report as any);
    ApiResponse.success(res, response, "Report fetched successfully");
  });

  approveReport = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(reportDetailSchema, req);
    const report = await this.reportService.approveReport(
      validated.params.reportId
    );
    ApiResponse.success(res, report, "Report approved successfully");
  });

  private mapFiles(files?: Express.Multer.File[]): StorageUploadInput[] {
    if (!files || files.length === 0) {
      return [];
    }

    return files.map((file) => ({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    }));
  }
}
