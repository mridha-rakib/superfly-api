export const QUOTE_SCHEDULE_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const QUOTE_SCHEDULE_MONTH_WEEKS = [
  "first",
  "second",
  "third",
  "fourth",
  "last",
] as const;

export const QUOTE_SCHEDULE_MONTHS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const;

export type QuoteScheduleWeekday = (typeof QUOTE_SCHEDULE_WEEKDAYS)[number];
export type QuoteScheduleMonthWeek = (typeof QUOTE_SCHEDULE_MONTH_WEEKS)[number];
export type QuoteScheduleMonth = number;
export type QuoteScheduleMonthDates = {
  month: QuoteScheduleMonth;
  dates: number[];
};

export type QuoteCleaningScheduleOneTime = {
  frequency: "one_time";
  schedule: {
    date: string;
    start_time: string;
    end_time: string;
  };
};

export type QuoteCleaningScheduleWeekly = {
  frequency: "weekly";
  days: QuoteScheduleWeekday[];
  start_time: string;
  end_time: string;
  repeat_until?: string;
};

export type QuoteCleaningScheduleMonthlySpecificDates = {
  frequency: "monthly";
  pattern_type: "specific_dates";
  months?: QuoteScheduleMonth[];
  dates?: number[];
  month_dates?: QuoteScheduleMonthDates[];
  start_time: string;
  end_time: string;
};

export type QuoteCleaningScheduleMonthlyWeekdayPattern = {
  frequency: "monthly";
  pattern_type: "weekday_pattern";
  months?: QuoteScheduleMonth[];
  week: QuoteScheduleMonthWeek;
  day: QuoteScheduleWeekday;
  start_time: string;
  end_time: string;
};

export type QuoteCleaningSchedule =
  | QuoteCleaningScheduleOneTime
  | QuoteCleaningScheduleWeekly
  | QuoteCleaningScheduleMonthlySpecificDates
  | QuoteCleaningScheduleMonthlyWeekdayPattern;
