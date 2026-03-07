import { QUOTE } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { S3Service, type StorageUploadInput } from "@/services/s3.service";
import { realtimeService } from "@/services/realtime.service";
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
import {
  QUOTE_SCHEDULE_MONTHS,
  type QuoteCleaningSchedule,
  type QuoteCleaningScheduleMonthlySpecificDates,
  type QuoteCleaningScheduleMonthlyWeekdayPattern,
  type QuoteScheduleMonthWeek,
  type QuoteScheduleWeekday,
} from "../quote/quote-schedule.type";
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

const SCHEDULE_WEEKDAY_TO_INDEX: Record<QuoteScheduleWeekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const MONTH_DAY_LIMITS: Record<number, number> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
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

    const assignedIds = Array.from(
      new Set(
        [
          quote.assignedCleanerId?.toString(),
          ...(quote.assignedCleanerIds || []).map((id) => id.toString()),
        ].filter((id): id is string => Boolean(id))
      )
    );

    if (!assignedIds.includes(cleanerId)) {
      throw new ForbiddenException("Cleaner is not assigned to this quote");
    }

    const occurrenceDate = this.resolveOccurrenceDateForSubmission(
      quote,
      payload.occurrenceDate
    );
    const existing = await this.reportRepository.findByQuoteAndOccurrence(
      quoteId,
      occurrenceDate
    );
    if (existing) {
      throw new ConflictException(
        `Report already submitted for ${occurrenceDate}`
      );
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

    const submissionTime = new Date();

    const report = await this.reportRepository.create({
      quoteId: quote._id,
      cleanerId,
      occurrenceDate,
      beforePhotos,
      afterPhotos,
      arrivalTime,
      startTime,
      endTime,
      notes: payload.notes?.trim(),
      status: QUOTE.REPORT_STATUSES.PENDING,
    });

    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      const updatePayload: Partial<IQuote> = {
        reportStatus: QUOTE.REPORT_STATUSES.PENDING,
        reportSubmittedBy: cleanerId,
        reportSubmittedAt: submissionTime,
      };

      if (quote.cleaningStatus !== QUOTE.CLEANING_STATUSES.COMPLETED) {
        updatePayload.cleaningStatus = QUOTE.CLEANING_STATUSES.COMPLETED;
      }

      await this.quoteRepository.updateById(quoteId, updatePayload);
    }

    realtimeService.emitReportSubmitted({
      quoteId: quote._id.toString(),
      submittedBy: cleanerId,
      assignedCleanerIds: assignedIds,
      reportStatus: QUOTE.REPORT_STATUSES.PENDING,
      submittedAt: submissionTime.toISOString(),
    });

    try {
      await this.quoteService.notifyAdminReportSubmitted(quote, {
        reportId: report._id.toString(),
        occurrenceDate,
        submittedBy: cleanerId,
        submittedAt: submissionTime,
      });
    } catch (error) {
      logger.warn(
        { quoteId: quote._id.toString(), reportId: report._id.toString(), error },
        "Admin report-submitted notification failed",
      );
    }

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

    let completedQuote: IQuote | null = null;

    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
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

      completedQuote = await this.quoteRepository.updateById(
        quote._id.toString(),
        {
          reportStatus: QUOTE.REPORT_STATUSES.APPROVED,
          cleaningStatus: QUOTE.CLEANING_STATUSES.COMPLETED,
          status: QUOTE.STATUSES.COMPLETED,
          paymentStatus: quote.paymentStatus || "paid",
          paidAt: quote.paidAt || new Date(),
          cleanerSharePercentage: sharePercentage,
          cleanerPercentage: perCleanerPercentage,
          cleanerEarningAmount,
        },
      );
    }

    if (completedQuote) {
      try {
        await this.quoteService.notifyAdminBookingCompleted(completedQuote, {
          eventKey: "report_approved",
          status: QUOTE.STATUSES.COMPLETED,
        });
      } catch (error) {
        logger.warn(
          { quoteId: completedQuote._id.toString(), reportId, error },
          "Admin booking-completed notification failed",
        );
      }
    }

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
      occurrenceDate:
        report.occurrenceDate || this.toDateString(report.startTime),
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

  private resolveOccurrenceDateForSubmission(
    quote: IQuote,
    rawOccurrenceDate?: string
  ): string {
    const quoteServiceDate = this.toDateString(
      this.parseDateOnly(quote.serviceDate, "Quote service date")
    );

    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      if (rawOccurrenceDate?.trim()) {
        const requestedDate = this.toDateString(
          this.parseDateOnly(rawOccurrenceDate, "Occurrence date")
        );
        if (requestedDate !== quoteServiceDate) {
          throw new BadRequestException(
            "Residential reports must use the booking service date"
          );
        }
      }
      return quoteServiceDate;
    }

    if (!rawOccurrenceDate?.trim()) {
      throw new BadRequestException(
        "Occurrence date is required for commercial and post-construction reports"
      );
    }

    const occurrenceDate = this.toDateString(
      this.parseDateOnly(rawOccurrenceDate, "Occurrence date")
    );

    if (!this.isOccurrenceAllowedForQuote(quote, occurrenceDate)) {
      throw new BadRequestException(
        "Occurrence date is not part of this booking schedule"
      );
    }

    return occurrenceDate;
  }

  private isOccurrenceAllowedForQuote(
    quote: IQuote,
    occurrenceDate: string
  ): boolean {
    const occurrence = this.parseDateOnly(occurrenceDate, "Occurrence date");
    const quoteServiceDate = this.parseDateOnly(
      quote.serviceDate,
      "Quote service date"
    );

    if (this.startOfDay(occurrence) < this.startOfDay(quoteServiceDate)) {
      return false;
    }

    const schedule = quote.cleaningSchedule as QuoteCleaningSchedule | undefined;
    if (!schedule || typeof schedule !== "object" || !("frequency" in schedule)) {
      return occurrenceDate === this.toDateString(quoteServiceDate);
    }

    return this.isMatchingScheduleDate(schedule, occurrence);
  }

  private isMatchingScheduleDate(
    schedule: QuoteCleaningSchedule,
    occurrence: Date
  ): boolean {
    if (schedule.frequency === "one_time") {
      const scheduleDate = this.toDateString(
        this.parseDateOnly(schedule.schedule.date, "Schedule date")
      );
      return scheduleDate === this.toDateString(occurrence);
    }

    if (schedule.frequency === "weekly") {
      return this.isMatchingWeeklySchedule(schedule, occurrence);
    }

    if (
      schedule.frequency === "monthly" &&
      schedule.pattern_type === "specific_dates"
    ) {
      return this.isMatchingMonthlySpecificDate(schedule, occurrence);
    }

    if (
      schedule.frequency === "monthly" &&
      schedule.pattern_type === "weekday_pattern"
    ) {
      return this.isMatchingMonthlyWeekdayPattern(schedule, occurrence);
    }

    return false;
  }

  private isMatchingWeeklySchedule(
    schedule: Extract<QuoteCleaningSchedule, { frequency: "weekly" }>,
    occurrence: Date
  ): boolean {
    const days = new Set<QuoteScheduleWeekday>(
      (Array.isArray(schedule.days) ? schedule.days : [])
        .map((day) => String(day || "").trim().toLowerCase() as QuoteScheduleWeekday)
        .filter((day) => day in SCHEDULE_WEEKDAY_TO_INDEX)
    );

    if (!days.size) {
      return false;
    }

    const weekday = this.weekdayFromDate(occurrence);
    if (!days.has(weekday)) {
      return false;
    }

    if (schedule.repeat_until?.trim()) {
      const repeatUntil = this.parseDateOnly(
        schedule.repeat_until,
        "Repeat until date"
      );
      if (this.startOfDay(occurrence) > this.startOfDay(repeatUntil)) {
        return false;
      }
    }

    return true;
  }

  private isMatchingMonthlySpecificDate(
    schedule: QuoteCleaningScheduleMonthlySpecificDates,
    occurrence: Date
  ): boolean {
    const monthValue = occurrence.getMonth() + 1;
    const dates = this.resolveMonthlyDatesMap(schedule).get(monthValue) || [];
    return dates.includes(occurrence.getDate());
  }

  private isMatchingMonthlyWeekdayPattern(
    schedule: QuoteCleaningScheduleMonthlyWeekdayPattern,
    occurrence: Date
  ): boolean {
    const monthValue = occurrence.getMonth() + 1;
    const months = this.normalizeScheduleMonths(schedule.months);
    if (!months.includes(monthValue)) {
      return false;
    }

    const week = String(schedule.week || "").trim().toLowerCase() as QuoteScheduleMonthWeek;
    const day = String(schedule.day || "").trim().toLowerCase() as QuoteScheduleWeekday;
    if (!["first", "second", "third", "fourth", "last"].includes(week)) {
      return false;
    }
    if (!(day in SCHEDULE_WEEKDAY_TO_INDEX)) {
      return false;
    }

    const dayOfMonth = this.getWeekdayPatternDayOfMonth(
      occurrence.getFullYear(),
      occurrence.getMonth(),
      week,
      day
    );

    return dayOfMonth !== null && occurrence.getDate() === dayOfMonth;
  }

  private parseScheduleMonths(months?: number[]): number[] {
    return Array.from(
      new Set(
        (Array.isArray(months) ? months : [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 12)
      )
    ).sort((a, b) => a - b);
  }

  private normalizeScheduleMonths(months?: number[]): number[] {
    const normalized = this.parseScheduleMonths(months);
    return normalized.length ? normalized : [...QUOTE_SCHEDULE_MONTHS];
  }

  private maxDayForMonth(month: number): number {
    return MONTH_DAY_LIMITS[month] || 31;
  }

  private normalizeDatesForMonth(dates: number[] | undefined, month: number): number[] {
    const maxDay = this.maxDayForMonth(month);
    return Array.from(
      new Set(
        (Array.isArray(dates) ? dates : [])
          .map((value) => Number(value))
          .filter(
            (value) => Number.isInteger(value) && value >= 1 && value <= maxDay
          )
      )
    ).sort((a, b) => a - b);
  }

  private resolveMonthlyDatesMap(
    schedule: QuoteCleaningScheduleMonthlySpecificDates
  ): Map<number, number[]> {
    const months = this.normalizeScheduleMonths(schedule.months);
    const result = new Map<number, number[]>();

    if (Array.isArray(schedule.month_dates) && schedule.month_dates.length > 0) {
      for (const entry of schedule.month_dates) {
        const month = Number(entry.month);
        if (!months.includes(month)) {
          continue;
        }
        const dates = this.normalizeDatesForMonth(entry.dates, month);
        if (dates.length) {
          result.set(month, dates);
        }
      }
    } else {
      const fallbackDates = Array.from(
        new Set(
          (Array.isArray(schedule.dates) ? schedule.dates : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31)
        )
      ).sort((a, b) => a - b);

      for (const month of months) {
        const dates = this.normalizeDatesForMonth(fallbackDates, month);
        if (dates.length) {
          result.set(month, dates);
        }
      }
    }

    return result;
  }

  private getWeekdayPatternDayOfMonth(
    year: number,
    month: number,
    week: QuoteScheduleMonthWeek,
    day: QuoteScheduleWeekday
  ): number | null {
    const targetWeekday = SCHEDULE_WEEKDAY_TO_INDEX[day];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    if (week === "last") {
      const lastDayWeekday = new Date(year, month, daysInMonth).getDay();
      const delta = (lastDayWeekday - targetWeekday + 7) % 7;
      return daysInMonth - delta;
    }

    const firstDayWeekday = new Date(year, month, 1).getDay();
    const offsetFromFirst = (targetWeekday - firstDayWeekday + 7) % 7;
    const weekOffset =
      week === "first"
        ? 0
        : week === "second"
        ? 1
        : week === "third"
        ? 2
        : 3;
    const dayOfMonth = 1 + offsetFromFirst + weekOffset * 7;

    if (dayOfMonth > daysInMonth) {
      return null;
    }

    return dayOfMonth;
  }

  private weekdayFromDate(value: Date): QuoteScheduleWeekday {
    switch (value.getDay()) {
      case 1:
        return "monday";
      case 2:
        return "tuesday";
      case 3:
        return "wednesday";
      case 4:
        return "thursday";
      case 5:
        return "friday";
      case 6:
        return "saturday";
      default:
        return "sunday";
    }
  }

  private parseDateOnly(value: string, fieldName: string): Date {
    if (!this.isValidDateString(value)) {
      throw new BadRequestException(
        `${fieldName} must be in YYYY-MM-DD format`
      );
    }

    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  private isValidDateString(value: string): boolean {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    );
  }

  private toDateString(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private startOfDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
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
