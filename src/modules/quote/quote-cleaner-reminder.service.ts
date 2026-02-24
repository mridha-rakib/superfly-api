import { QUOTE, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { normalizeTimeTo24Hour } from "@/utils/time.utils";
import type { IQuote } from "./quote.interface";
import type { QuoteCleanerReminderType } from "./quote-cleaner-reminder.interface";
import { QuoteCleanerReminderRepository } from "./quote-cleaner-reminder.repository";
import { QuoteRepository } from "./quote.repository";
import { UserService } from "../user/user.service";

type ReminderFrequency = "one-time" | "daily" | "weekly" | "monthly";

type CleanerContact = {
  id: string;
  fullName: string;
  email: string;
};

export type QuoteCleanerReminderRunResult = {
  scannedQuotes: number;
  matchedOccurrences: number;
  sent: number;
  skippedAlreadySent: number;
  skippedNoCleaner: number;
  skippedNoEmail: number;
  skippedInvalidSchedule: number;
  failed: number;
};

export class QuoteCleanerReminderService {
  private static readonly REMINDER_TYPE: QuoteCleanerReminderType =
    "cleaner_24h_before";
  private static readonly LEAD_TIME_MS = 24 * 60 * 60 * 1000;
  private static readonly LOOKBACK_MS = 60 * 60 * 1000;
  private static readonly LOOKAHEAD_MS = 0;

  private quoteRepository: QuoteRepository;
  private reminderRepository: QuoteCleanerReminderRepository;
  private userService: UserService;
  private emailService: EmailService;
  private dateTimeFormatter: Intl.DateTimeFormat;

  constructor() {
    this.quoteRepository = new QuoteRepository();
    this.reminderRepository = new QuoteCleanerReminderRepository();
    this.userService = new UserService();
    this.emailService = new EmailService();
    this.dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
    });
  }

  async processDueReminders(
    now: Date = new Date(),
  ): Promise<QuoteCleanerReminderRunResult> {
    const reminderWindowStart = new Date(
      now.getTime() - QuoteCleanerReminderService.LOOKBACK_MS,
    );
    const reminderWindowEnd = new Date(
      now.getTime() + QuoteCleanerReminderService.LOOKAHEAD_MS,
    );
    const occurrenceWindowStart = new Date(
      reminderWindowStart.getTime() + QuoteCleanerReminderService.LEAD_TIME_MS,
    );
    const occurrenceWindowEnd = new Date(
      reminderWindowEnd.getTime() + QuoteCleanerReminderService.LEAD_TIME_MS,
    );
    const maxServiceDate = this.toDateString(occurrenceWindowEnd);

    const quotes =
      await this.quoteRepository.findManualQuotesForCleanerReminder(
        maxServiceDate,
      );

    const result: QuoteCleanerReminderRunResult = {
      scannedQuotes: quotes.length,
      matchedOccurrences: 0,
      sent: 0,
      skippedAlreadySent: 0,
      skippedNoCleaner: 0,
      skippedNoEmail: 0,
      skippedInvalidSchedule: 0,
      failed: 0,
    };

    for (const quote of quotes) {
      const baseOccurrence = this.parseServiceDateTime(
        quote.serviceDate,
        quote.preferredTime,
      );
      if (!baseOccurrence) {
        result.skippedInvalidSchedule += 1;
        continue;
      }

      const frequency = this.normalizeFrequency(quote.cleaningFrequency);
      const occurrences = this.findOccurrencesInWindow(
        baseOccurrence,
        frequency,
        occurrenceWindowStart,
        occurrenceWindowEnd,
      );

      if (!occurrences.length) {
        continue;
      }

      result.matchedOccurrences += occurrences.length;

      const cleanerIds = this.extractAssignedCleanerIds(quote);
      if (!cleanerIds.length) {
        result.skippedNoCleaner += 1;
        continue;
      }

      const cleanerMap = await this.loadCleanerMap(cleanerIds);
      if (!cleanerMap.size) {
        result.skippedNoEmail += cleanerIds.length;
        continue;
      }

      for (const occurrenceStartAt of occurrences) {
        for (const cleanerId of cleanerIds) {
          const cleaner = cleanerMap.get(cleanerId);
          if (!cleaner || !cleaner.email) {
            result.skippedNoEmail += 1;
            continue;
          }

          const reminderLookup = {
            quoteId: quote._id,
            cleanerId,
            occurrenceStartAt,
            reminderType: QuoteCleanerReminderService.REMINDER_TYPE,
          };

          const alreadySent =
            await this.reminderRepository.hasSent(reminderLookup);
          if (alreadySent) {
            result.skippedAlreadySent += 1;
            continue;
          }

          try {
            await this.emailService.sendCleanerScheduleReminder({
              to: cleaner.email,
              cleanerName: cleaner.fullName || "Cleaner",
              serviceType: this.serviceTypeLabel(quote.serviceType),
              scheduledFor: this.dateTimeFormatter.format(occurrenceStartAt),
              companyName: quote.companyName,
              businessAddress: quote.businessAddress,
              cleaningFrequency: this.frequencyLabel(frequency),
            });

            await this.reminderRepository.createOnce({
              ...reminderLookup,
              sentAt: new Date(),
            });

            result.sent += 1;
          } catch (error) {
            result.failed += 1;
            logger.warn(
              {
                quoteId: quote._id.toString(),
                cleanerId,
                cleanerEmail: cleaner.email,
                occurrenceStartAt: occurrenceStartAt.toISOString(),
                error,
              },
              "Failed to send cleaner reminder email",
            );
          }
        }
      }
    }

    return result;
  }

  private async loadCleanerMap(cleanerIds: string[]): Promise<Map<string, CleanerContact>> {
    const cleaners = await this.userService.getUsersByIds(cleanerIds);
    const cleanerMap = new Map<string, CleanerContact>();

    cleaners
      .filter((cleaner) => cleaner.role === ROLES.CLEANER)
      .forEach((cleaner) => {
        if (!cleaner.email) {
          return;
        }

        cleanerMap.set(cleaner._id.toString(), {
          id: cleaner._id.toString(),
          fullName: cleaner.fullName || "Cleaner",
          email: cleaner.email.toLowerCase(),
        });
      });

    return cleanerMap;
  }

  private extractAssignedCleanerIds(quote: IQuote): string[] {
    const ids = [
      ...(quote.assignedCleanerIds || []).map((id) => id.toString()),
      quote.assignedCleanerId ? quote.assignedCleanerId.toString() : "",
    ].filter(Boolean);

    return Array.from(new Set(ids));
  }

  private parseServiceDateTime(
    serviceDate?: string,
    preferredTime?: string,
  ): Date | null {
    if (!serviceDate) {
      return null;
    }

    const dateMatch = serviceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return null;
    }

    const normalizedTime = normalizeTimeTo24Hour(preferredTime || "");
    const timeMatch = normalizedTime.match(/^(\d{2}):(\d{2})$/);
    if (!timeMatch) {
      return null;
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);

    const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  private normalizeFrequency(value?: string): ReminderFrequency {
    const normalized = (value || "").trim().toLowerCase();
    if (
      normalized === "daily" ||
      normalized === "weekly" ||
      normalized === "monthly"
    ) {
      return normalized;
    }
    return "one-time";
  }

  private findOccurrencesInWindow(
    baseOccurrence: Date,
    frequency: ReminderFrequency,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] {
    if (windowEnd < windowStart) {
      return [];
    }

    if (frequency === "one-time") {
      return baseOccurrence >= windowStart && baseOccurrence <= windowEnd
        ? [new Date(baseOccurrence)]
        : [];
    }

    if (frequency === "daily") {
      return this.findDayIntervalOccurrences(
        baseOccurrence,
        1,
        windowStart,
        windowEnd,
      );
    }

    if (frequency === "weekly") {
      return this.findDayIntervalOccurrences(
        baseOccurrence,
        7,
        windowStart,
        windowEnd,
      );
    }

    return this.findMonthlyOccurrences(baseOccurrence, windowStart, windowEnd);
  }

  private findDayIntervalOccurrences(
    baseOccurrence: Date,
    intervalDays: number,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] {
    const occurrences: Date[] = [];
    let occurrence = new Date(baseOccurrence);

    if (occurrence < windowStart) {
      const baseDayUtc = Date.UTC(
        baseOccurrence.getFullYear(),
        baseOccurrence.getMonth(),
        baseOccurrence.getDate(),
      );
      const startDayUtc = Date.UTC(
        windowStart.getFullYear(),
        windowStart.getMonth(),
        windowStart.getDate(),
      );
      const elapsedDays = Math.max(
        0,
        Math.floor((startDayUtc - baseDayUtc) / (24 * 60 * 60 * 1000)),
      );
      const jumps = Math.floor(elapsedDays / intervalDays);
      occurrence = this.addDays(baseOccurrence, jumps * intervalDays);

      while (occurrence < windowStart) {
        occurrence = this.addDays(occurrence, intervalDays);
      }
    }

    while (occurrence <= windowEnd) {
      occurrences.push(new Date(occurrence));
      occurrence = this.addDays(occurrence, intervalDays);
    }

    return occurrences;
  }

  private findMonthlyOccurrences(
    baseOccurrence: Date,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] {
    const occurrences: Date[] = [];
    let offset = 0;
    let occurrence = new Date(baseOccurrence);

    if (occurrence < windowStart) {
      offset = this.monthDifference(baseOccurrence, windowStart);
      occurrence = this.addMonthsClamped(baseOccurrence, offset);

      while (occurrence < windowStart) {
        offset += 1;
        occurrence = this.addMonthsClamped(baseOccurrence, offset);
      }
    }

    while (occurrence <= windowEnd) {
      occurrences.push(new Date(occurrence));
      offset += 1;
      occurrence = this.addMonthsClamped(baseOccurrence, offset);
    }

    return occurrences;
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  }

  private monthDifference(from: Date, to: Date): number {
    return (
      (to.getFullYear() - from.getFullYear()) * 12 +
      (to.getMonth() - from.getMonth())
    );
  }

  private addMonthsClamped(value: Date, months: number): Date {
    const yearMonth = value.getMonth() + months;
    const year = value.getFullYear() + Math.floor(yearMonth / 12);
    const month = ((yearMonth % 12) + 12) % 12;
    const day = value.getDate();
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    const nextDay = Math.min(day, lastDayOfMonth);

    return new Date(
      year,
      month,
      nextDay,
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
    );
  }

  private serviceTypeLabel(serviceType: string): string {
    if (serviceType === QUOTE.SERVICE_TYPES.COMMERCIAL) {
      return "Commercial Cleaning";
    }
    if (serviceType === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION) {
      return "Post-Construction Cleaning";
    }
    return "Cleaning";
  }

  private frequencyLabel(frequency: ReminderFrequency): string {
    switch (frequency) {
      case "daily":
        return "Daily";
      case "weekly":
        return "Weekly";
      case "monthly":
        return "Monthly";
      default:
        return "One Time";
    }
  }

  private toDateString(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
