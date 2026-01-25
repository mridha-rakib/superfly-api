import { QUOTE } from "@/constants/app.constants";
import { S3Service, type StorageUploadInput } from "@/services/s3.service";
import type { PaginateResult } from "@/ts/pagination.types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@/utils/app-error.utils";
import type { PaginateOptions } from "mongoose";
import type { IQuote } from "../quote/quote.interface";
import { QuoteRepository } from "../quote/quote.repository";
import { QuoteService } from "../quote/quote.service";
import { UserService } from "../user/user.service";
import type { IUser } from "../user/user.interface";
import type { ICleaningReport } from "./cleaning-report.interface";
import { CleaningReportRepository } from "./cleaning-report.repository";
import type {
  CleaningReportAdminResponse,
  CleaningReportCreatePayload,
  CleaningReportResponse,
} from "./cleaning-report.type";

type ReportDetails = ICleaningReport & {
  quoteId?: IQuote | string;
  cleanerId?: IUser | string;
};

type CleaningReportMediaPayload = {
  beforeFiles?: StorageUploadInput[];
  afterFiles?: StorageUploadInput[];
};

export class CleaningReportService {
  private reportRepository: CleaningReportRepository;
  private quoteRepository: QuoteRepository;
  private quoteService: QuoteService;
  private storageService: S3Service;
  private userService: UserService;

  constructor() {
    this.reportRepository = new CleaningReportRepository();
    this.quoteRepository = new QuoteRepository();
    this.quoteService = new QuoteService();
    this.storageService = new S3Service();
    this.userService = new UserService();
  }

  async createReport(
    quoteId: string,
    cleanerId: string,
    payload: CleaningReportCreatePayload,
    media: CleaningReportMediaPayload = {}
  ): Promise<CleaningReportResponse> {
    const quote = await this.quoteRepository.findById(quoteId);
    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (quote.serviceType !== QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      throw new BadRequestException(
        "Reports are only supported for residential quotes"
      );
    }

    const assignedIds = [
      quote.assignedCleanerId?.toString(),
      ...(quote.assignedCleanerIds || []).map((id) => id.toString()),
    ].filter(Boolean);

    if (!assignedIds.includes(cleanerId)) {
      throw new ForbiddenException("Cleaner is not assigned to this quote");
    }

    const existing = await this.reportRepository.findByQuoteId(quoteId);
    if (existing) {
      throw new ConflictException("Report already submitted for this quote");
    }

    const arrivalTime = this.parseDate(payload.arrivalTime, "Arrival time");
    const startTime = this.parseDate(payload.startTime, "Start time");
    const endTime = this.parseDate(payload.endTime, "End time");

    if (arrivalTime > startTime) {
      throw new BadRequestException(
        "Arrival time must be before the start time"
      );
    }

    if (startTime > endTime) {
      throw new BadRequestException("Start time must be before the end time");
    }

    const beforeUrls = this.normalizePhotoUrls(payload.beforePhotos);
    const afterUrls = this.normalizePhotoUrls(payload.afterPhotos);
    const beforeUploads = await this.uploadPhotoFiles(
      quoteId,
      "before",
      media.beforeFiles || []
    );
    const afterUploads = await this.uploadPhotoFiles(
      quoteId,
      "after",
      media.afterFiles || []
    );
    const beforePhotos = [...beforeUrls, ...beforeUploads];
    const afterPhotos = [...afterUrls, ...afterUploads];

    if (beforePhotos.length === 0 || afterPhotos.length === 0) {
      throw new BadRequestException("Before and after photos are required");
    }

    const report = await this.reportRepository.create({
      quoteId: quote._id,
      cleanerId,
      beforePhotos,
      afterPhotos,
      arrivalTime,
      startTime,
      endTime,
      notes: payload.notes?.trim(),
      status: QUOTE.REPORT_STATUSES.PENDING,
    });

    await this.quoteRepository.updateById(quoteId, {
      reportStatus: QUOTE.REPORT_STATUSES.PENDING,
    });

    return this.toResponse(report as ReportDetails);
  }

  async getPaginated(
    filter: Record<string, any>,
    options: PaginateOptions
  ): Promise<PaginateResult<ICleaningReport>> {
    const finalFilter = { ...filter };
    return this.reportRepository.paginate(finalFilter, {
      ...options,
      populate: [
        { path: "quoteId" },
        {
          path: "cleanerId",
          select: "fullName email phoneNumber profileImageUrl",
        },
      ],
    });
  }

  async getAll(
    filter: Record<string, any> = {},
    options: Record<string, any> = {}
  ): Promise<ICleaningReport[]> {
    return this.reportRepository.findAllWithDetails(filter, {
      sort: { createdAt: -1 },
      ...options,
    });
  }

  async getById(reportId: string): Promise<ICleaningReport> {
    const report = await this.reportRepository.findByIdWithDetails(reportId);
    if (!report) {
      throw new NotFoundException("Report not found");
    }
    return report;
  }

  async approveReport(reportId: string): Promise<CleaningReportAdminResponse> {
    const report = await this.reportRepository.findById(reportId);
    if (!report) {
      throw new NotFoundException("Report not found");
    }

    if (report.status === QUOTE.REPORT_STATUSES.APPROVED) {
      const reportWithDetails = await this.reportRepository.findByIdWithDetails(
        reportId
      );
      return this.toAdminResponse(
        (reportWithDetails || report) as ReportDetails
      );
    }

    report.status = QUOTE.REPORT_STATUSES.APPROVED;
    await report.save();

    const quote = await this.quoteRepository.findById(
      report.quoteId.toString()
    );

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (quote.serviceType !== QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      throw new BadRequestException(
        "Report approval is only supported for residential quotes"
      );
    }

    const {
      sharePercentage,
      perCleanerPercentage,
      cleanerCount,
    } = await this.resolveCleanerSplit(quote);
    const totalAmount = this.resolveQuoteTotal(quote);
    const cleanerEarningAmount =
      totalAmount > 0
        ? Number(
            (
              (totalAmount * sharePercentage) /
              (100 * Math.max(cleanerCount, 1))
            ).toFixed(2)
          )
        : 0;

    await this.quoteRepository.updateById(quote._id.toString(), {
      reportStatus: QUOTE.REPORT_STATUSES.APPROVED,
      cleaningStatus: QUOTE.CLEANING_STATUSES.COMPLETED,
      status: QUOTE.STATUSES.COMPLETED,
      paymentStatus: quote.paymentStatus || "paid",
      paidAt: quote.paidAt || new Date(),
      cleanerSharePercentage: sharePercentage,
      cleanerPercentage: perCleanerPercentage,
      cleanerEarningAmount,
    });

    const reportWithDetails = await this.reportRepository.findByIdWithDetails(
      reportId
    );

    return this.toAdminResponse(
      (reportWithDetails || report) as ReportDetails
    );
  }

  toResponse(report: ReportDetails): CleaningReportResponse {
    return {
      _id: report._id.toString(),
      quoteId: this.resolveId(report.quoteId),
      cleanerId: this.resolveId(report.cleanerId),
      beforePhotos: report.beforePhotos || [],
      afterPhotos: report.afterPhotos || [],
      arrivalTime: report.arrivalTime,
      startTime: report.startTime,
      endTime: report.endTime,
      notes: report.notes,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }

  toAdminResponse(report: ReportDetails): CleaningReportAdminResponse {
    const base = this.toResponse(report);
    const quote =
      report.quoteId &&
      typeof report.quoteId === "object" &&
      "serviceType" in report.quoteId
        ? this.quoteService.toResponse(report.quoteId as IQuote)
        : undefined;
    const cleaner =
      report.cleanerId &&
      typeof report.cleanerId === "object" &&
      "fullName" in report.cleanerId
        ? {
            _id: (report.cleanerId as IUser)._id.toString(),
            fullName: (report.cleanerId as IUser).fullName,
            email: (report.cleanerId as IUser).email,
            phoneNumber: (report.cleanerId as IUser).phoneNumber,
            profileImageUrl:
              (report.cleanerId as IUser).profileImageUrl || undefined,
          }
        : undefined;

    return {
      ...base,
      quote,
      cleaner,
    };
  }

  private parseDate(value: string, label: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${label} must be a valid datetime`);
    }
    return parsed;
  }

  private normalizePhotoUrls(photos?: string[]): string[] {
    return (photos || []).map((url) => url.trim()).filter(Boolean);
  }

  private async uploadPhotoFiles(
    quoteId: string,
    label: "before" | "after",
    files: StorageUploadInput[]
  ): Promise<string[]> {
    if (!files.length) {
      return [];
    }

    this.ensureImageFiles(files, `${label} photos`);

    const results = await this.storageService.uploadFiles(files, {
      prefix: `reports/${quoteId}/${label}`,
    });
    return results.map((result) => result.url);
  }

  private ensureImageFiles(
    files: StorageUploadInput[],
    label: string
  ): void {
    const invalid = files.filter(
      (file) => !file.mimeType?.startsWith("image/")
    );
    if (invalid.length > 0) {
      throw new BadRequestException(`${label} must be image files`);
    }
  }

  private resolveId(value: unknown): string {
    if (!value) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "object" && (value as any)._id) {
      return (value as any)._id.toString();
    }
    return String(value);
  }

  private async resolveCleanerSplit(
    quote: IQuote
  ): Promise<{
    sharePercentage: number;
    perCleanerPercentage: number;
    cleanerCount: number;
  }> {
    const assigned = [
      quote.assignedCleanerId,
      ...(quote.assignedCleanerIds || []),
    ]
      .map((id) => (id ? id.toString() : undefined))
      .filter(Boolean) as string[];

    const uniqueAssigned = Array.from(new Set(assigned));
    const cleanerCount = uniqueAssigned.length || 1;

    // Prefer explicit quote-level share; fallback to primary cleaner's configured percentage.
    const primaryId = uniqueAssigned[0];
    const cleaner = primaryId
      ? await this.userService.getById(primaryId.toString())
      : null;

    const sharePercentage =
      quote.cleanerSharePercentage ??
      quote.cleanerPercentage ??
      cleaner?.cleanerPercentage ??
      0;

    const normalizedShare = Number.isFinite(sharePercentage)
      ? Number(sharePercentage)
      : 0;

    const perCleanerPercentage =
      cleanerCount > 0
        ? Number((normalizedShare / cleanerCount).toFixed(4))
        : normalizedShare;

    return {
      sharePercentage: normalizedShare,
      perCleanerPercentage,
      cleanerCount,
    };
  }

  private resolveQuoteTotal(quote: IQuote): number {
    if (quote.totalPrice && quote.totalPrice > 0) {
      return quote.totalPrice;
    }
    if (quote.paymentAmount && quote.paymentAmount > 0) {
      return Number((quote.paymentAmount / 100).toFixed(2));
    }
    return 0;
  }
}
