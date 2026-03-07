import { QUOTE, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { normalizeTimeTo24Hour } from "@/utils/time.utils";
import type { IQuote } from "./quote.interface";
import type { QuoteCleanerReminderType } from "./quote-cleaner-reminder.interface";
import { QuoteCleanerReminderRepository } from "./quote-cleaner-reminder.repository";
import { QuoteRepository } from "./quote.repository";
import { UserService } from "../user/user.service";
import type {
  QuoteCleaningSchedule,
  QuoteCleaningScheduleMonthlySpecificDates,
  QuoteCleaningScheduleMonthlyWeekdayPattern,
  QuoteCleaningScheduleWeekly,
  QuoteScheduleMonthWeek,
  QuoteScheduleWeekday,
} from "./quote-schedule.type";
import { QUOTE_SCHEDULE_MONTHS } from "./quote-schedule.type";

type ReminderFrequency = "one-time" | "daily" | "weekly" | "monthly";

type CleanerContact = {
  id: string;
  fullName: string;
  email: string;
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
  /**
   * Keep the legacy key to preserve idempotency with existing reminder records.
   * Changing this value would resend reminders for the same occurrence after deployment.
   */
  private static readonly REMINDER_TYPE: QuoteCleanerReminderType =
    "cleaner_24h_before";
  private static readonly MIN_LEAD_TIME_MS = 12 * 60 * 60 * 1000;
  private static readonly MAX_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

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
    const occurrenceWindowStart = new Date(
      now.getTime() + QuoteCleanerReminderService.MIN_LEAD_TIME_MS,
    );
    const occurrenceWindowEnd = new Date(
      now.getTime() + QuoteCleanerReminderService.MAX_LEAD_TIME_MS,
    );
    const maxServiceDate = this.toDateString(occurrenceWindowEnd);

    const quotes = await this.quoteRepository.findQuotesForCleanerReminder(
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
      const frequency = this.resolveReminderFrequency(quote);
      const occurrences = this.findOccurrencesForQuote(
        quote,
        frequency,
        occurrenceWindowStart,
        occurrenceWindowEnd,
      );
      if (!occurrences) {
        result.skippedInvalidSchedule += 1;
        continue;
      }

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

  private resolveReminderFrequency(quote: IQuote): ReminderFrequency {
    const scheduleFrequency = quote.cleaningSchedule?.frequency;
    if (scheduleFrequency === "one_time") {
      return "one-time";
    }
    if (scheduleFrequency === "weekly" || scheduleFrequency === "monthly") {
      return scheduleFrequency;
    }

    return this.normalizeFrequency(quote.cleaningFrequency);
  }

  private findOccurrencesForQuote(
    quote: IQuote,
    frequency: ReminderFrequency,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] | null {
    if (windowEnd < windowStart) {
      return [];
    }

    const schedule = quote.cleaningSchedule;
    if (schedule) {
      return this.findOccurrencesFromSchedule(quote, schedule, windowStart, windowEnd);
    }

    const baseOccurrence = this.parseServiceDateTime(
      quote.serviceDate,
      quote.preferredTime,
    );
    if (!baseOccurrence) {
      return null;
    }

    return this.findOccurrencesInWindow(
      baseOccurrence,
      frequency,
      windowStart,
      windowEnd,
    );
  }

  private findOccurrencesFromSchedule(
    quote: IQuote,
    schedule: QuoteCleaningSchedule,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] | null {
    const startsOn = quote.serviceDate
      ? this.parseDateOnly(quote.serviceDate)
      : null;

    if (schedule.frequency === "one_time") {
      const oneTime = this.parseServiceDateTime(
        schedule.schedule.date,
        schedule.schedule.start_time,
      );
      if (!oneTime) {
        return null;
      }
      return oneTime >= windowStart && oneTime <= windowEnd ? [oneTime] : [];
    }

    if (schedule.frequency === "weekly") {
      return this.findWeeklyScheduleOccurrences(
        schedule,
        startsOn,
        windowStart,
        windowEnd,
      );
    }

    if (schedule.pattern_type === "specific_dates") {
      return this.findMonthlySpecificDateScheduleOccurrences(
        schedule,
        startsOn,
        windowStart,
        windowEnd,
      );
    }

    return this.findMonthlyWeekdayPatternOccurrences(
      schedule,
      startsOn,
      windowStart,
      windowEnd,
    );
  }

  private findWeeklyScheduleOccurrences(
    schedule: QuoteCleaningScheduleWeekly,
    startsOn: Date | null,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] | null {
    const time = this.parseTime(schedule.start_time);
    if (!time) {
      return null;
    }

    const repeatUntil = schedule.repeat_until
      ? this.parseDateOnly(schedule.repeat_until)
      : null;
    if (schedule.repeat_until && !repeatUntil) {
      return null;
    }

    const repeatUntilEnd = repeatUntil
      ? new Date(
          repeatUntil.getFullYear(),
          repeatUntil.getMonth(),
          repeatUntil.getDate(),
          23,
          59,
          59,
          999,
        )
      : null;

    const daySet = new Set(
      schedule.days.map((day) => day.toLowerCase() as QuoteScheduleWeekday),
    );

    const occurrences: Date[] = [];
    const cursor = new Date(
      windowStart.getFullYear(),
      windowStart.getMonth(),
      windowStart.getDate(),
    );
    const endDate = new Date(
      windowEnd.getFullYear(),
      windowEnd.getMonth(),
      windowEnd.getDate(),
      23,
      59,
      59,
      999,
    );

    while (cursor <= endDate) {
      if (repeatUntilEnd && cursor > repeatUntilEnd) {
        break;
      }
      if (startsOn && cursor < startsOn) {
        cursor.setDate(cursor.getDate() + 1);
        continue;
      }

      const weekday = this.weekdayFromDate(cursor);
      if (daySet.has(weekday)) {
        const occurrence = new Date(cursor);
        occurrence.setHours(time.hours, time.minutes, 0, 0);
        if (occurrence >= windowStart && occurrence <= windowEnd) {
          occurrences.push(occurrence);
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return occurrences;
  }

  private findMonthlySpecificDateScheduleOccurrences(
    schedule: QuoteCleaningScheduleMonthlySpecificDates,
    startsOn: Date | null,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] | null {
    const time = this.parseTime(schedule.start_time);
    if (!time) {
      return null;
    }

    const monthDatesMap = this.resolveMonthlyDatesMap(schedule);
    const occurrences: Date[] = [];

    const monthCursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    const monthEnd = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);

    while (monthCursor <= monthEnd) {
      const year = monthCursor.getFullYear();
      const month = monthCursor.getMonth();
      const monthValue = month + 1;
      const dates = monthDatesMap.get(monthValue) || [];
      if (!dates.length) {
        monthCursor.setMonth(monthCursor.getMonth() + 1, 1);
        continue;
      }
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (const day of dates) {
        if (day < 1 || day > daysInMonth) {
          continue;
        }

        const candidateDay = new Date(year, month, day);
        if (startsOn && candidateDay < startsOn) {
          continue;
        }

        const occurrence = new Date(year, month, day, time.hours, time.minutes, 0, 0);
        if (occurrence >= windowStart && occurrence <= windowEnd) {
          occurrences.push(occurrence);
        }
      }

      monthCursor.setMonth(monthCursor.getMonth() + 1, 1);
    }

    return occurrences;
  }

  private findMonthlyWeekdayPatternOccurrences(
    schedule: QuoteCleaningScheduleMonthlyWeekdayPattern,
    startsOn: Date | null,
    windowStart: Date,
    windowEnd: Date,
  ): Date[] | null {
    const time = this.parseTime(schedule.start_time);
    if (!time) {
      return null;
    }

    const occurrences: Date[] = [];
    const monthSet = new Set(this.normalizeScheduleMonths(schedule.months));
    const monthCursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    const monthEnd = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);

    while (monthCursor <= monthEnd) {
      const year = monthCursor.getFullYear();
      const month = monthCursor.getMonth();
      const monthValue = month + 1;
      if (!monthSet.has(monthValue)) {
        monthCursor.setMonth(monthCursor.getMonth() + 1, 1);
        continue;
      }
      const dayOfMonth = this.getWeekdayPatternDayOfMonth(
        year,
        month,
        schedule.week,
        schedule.day,
      );

      if (dayOfMonth) {
        const candidateDay = new Date(year, month, dayOfMonth);
        if (!startsOn || candidateDay >= startsOn) {
          const occurrence = new Date(
            year,
            month,
            dayOfMonth,
            time.hours,
            time.minutes,
            0,
            0,
          );
          if (occurrence >= windowStart && occurrence <= windowEnd) {
            occurrences.push(occurrence);
          }
        }
      }

      monthCursor.setMonth(monthCursor.getMonth() + 1, 1);
    }

    return occurrences;
  }

  private getWeekdayPatternDayOfMonth(
    year: number,
    month: number,
    week: QuoteScheduleMonthWeek,
    day: QuoteScheduleWeekday,
  ): number | null {
    const targetWeekday = SCHEDULE_WEEKDAY_TO_INDEX[day];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    if (week === "last") {
      const lastWeekday = new Date(year, month, daysInMonth).getDay();
      const delta = (lastWeekday - targetWeekday + 7) % 7;
      return daysInMonth - delta;
    }

    const firstWeekday = new Date(year, month, 1).getDay();
    const offsetFromFirst = (targetWeekday - firstWeekday + 7) % 7;
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

  private parseDateOnly(value?: string): Date | null {
    if (!value) {
      return null;
    }

    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
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

  private parseTime(value?: string): { hours: number; minutes: number } | null {
    const normalized = normalizeTimeTo24Hour(value || "");
    const match = normalized.match(/^(\d{2}):(\d{2})$/);
    if (!match) {
      return null;
    }

    return {
      hours: Number(match[1]),
      minutes: Number(match[2]),
    };
  }

  private parseServiceDateTime(
    serviceDate?: string,
    preferredTime?: string,
  ): Date | null {
    const parsedDate = this.parseDateOnly(serviceDate);
    const parsedTime = this.parseTime(preferredTime);
    if (!parsedDate || !parsedTime) {
      return null;
    }

    return new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate(),
      parsedTime.hours,
      parsedTime.minutes,
      0,
      0,
    );
  }

  private normalizeFrequency(value?: string): ReminderFrequency {
    const normalized = (value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
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
            (value) => Number.isInteger(value) && value >= 1 && value <= maxDay,
          ),
      ),
    ).sort((a, b) => a - b);
  }

  private normalizeScheduleMonths(months?: number[]): number[] {
    const normalized = Array.from(
      new Set(
        (Array.isArray(months) ? months : [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 12),
      ),
    ).sort((a, b) => a - b);

    return normalized.length ? normalized : [...QUOTE_SCHEDULE_MONTHS];
  }

  private resolveMonthlyDatesMap(
    schedule: QuoteCleaningScheduleMonthlySpecificDates,
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
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31),
        ),
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

  private serviceTypeLabel(serviceType: string): string {
    if (serviceType === QUOTE.SERVICE_TYPES.COMMERCIAL) {
      return "Commercial Cleaning";
    }
    if (serviceType === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION) {
      return "Post-Construction Cleaning";
    }
    return "Residential Cleaning";
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
