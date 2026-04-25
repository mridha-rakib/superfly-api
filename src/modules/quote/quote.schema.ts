import { QUOTE } from "@/constants/app.constants";
import { parseTimeTo24Hour } from "@/utils/time.utils";
import { z } from "zod";
import {
  QUOTE_SCHEDULE_MONTHS,
  QUOTE_SCHEDULE_MONTH_WEEKS,
  QUOTE_SCHEDULE_WEEKDAYS,
} from "./quote-schedule.type";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_TIME_MESSAGE = "Time must be a valid time such as 9:00 AM or 09:00";

const serviceSelectionSchema = z.record(
  z.string().min(1),
  z.coerce.number().int().min(0).default(0),
);

const cleaningServiceOptions = z.enum([
  "janitorial_services",
  "carpet_cleaning",
  "window_cleaning",
  "pressure_washing",
  "floor_cleaning",
]);

const cleaningFrequencyOptions = z.enum([
  "one-time",
  "daily",
  "weekly",
  "monthly",
]);

const scheduleWeekdayOptions = z.enum(QUOTE_SCHEDULE_WEEKDAYS);
const scheduleMonthWeekOptions = z.enum(QUOTE_SCHEDULE_MONTH_WEEKS);
const scheduleMonthOptions = z.coerce
  .number()
  .int()
  .refine((value) => QUOTE_SCHEDULE_MONTHS.includes(value as (typeof QUOTE_SCHEDULE_MONTHS)[number]), {
    message: "Month must be between 1 and 12",
  });
const scheduleMonthsSchema = z
  .array(scheduleMonthOptions)
  .min(1, "Select at least one month")
  .optional();
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
const maxDayForMonth = (month: number) => MONTH_DAY_LIMITS[month] || 31;
const maxDayForMonths = (months?: number[]) => {
  const source = months?.length ? months : [...QUOTE_SCHEDULE_MONTHS];
  const values = source.map((month) => maxDayForMonth(month));
  return values.length ? Math.max(...values) : 31;
};

const dateStringSchema = z
  .string()
  .trim()
  .regex(DATE_PATTERN, "Date must be YYYY-MM-DD");
const normalizeTimeInput = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return parseTimeTo24Hour(trimmed) || trimmed;
};
const time24HourSchema = z.preprocess(
  normalizeTimeInput,
  z.string().trim().regex(TIME_24H_PATTERN, VALID_TIME_MESSAGE),
);
const fullNameSchema = z.string().trim().min(1, "Full name is required").max(200);

const booleanQueryParam = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}, z.boolean().optional());

const toMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const oneTimeCleaningScheduleSchema = z
  .object({
    frequency: z.literal("one_time"),
    schedule: z.object({
      date: dateStringSchema,
      start_time: time24HourSchema,
      end_time: time24HourSchema,
    }),
  })
  .superRefine((data, ctx) => {
    if (toMinutes(data.schedule.end_time) <= toMinutes(data.schedule.start_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedule", "end_time"],
        message: "End time must be after start time",
      });
    }
  });

const weeklyCleaningScheduleSchema = z
  .object({
    frequency: z.literal("weekly"),
    days: z
      .array(scheduleWeekdayOptions)
      .min(1, "Select at least one weekday"),
    start_time: time24HourSchema,
    end_time: time24HourSchema,
    repeat_until: dateStringSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.days).size !== data.days.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: "Weekdays must be unique",
      });
    }

    if (toMinutes(data.end_time) <= toMinutes(data.start_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_time"],
        message: "End time must be after start time",
      });
    }
  });

const monthlyMonthDatesSchema = z
  .object({
    month: scheduleMonthOptions,
    dates: z
      .array(z.coerce.number().int().min(1).max(31))
      .min(1, "Select at least one date"),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.dates).size !== data.dates.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dates"],
        message: "Dates must be unique",
      });
    }
    const maxDay = maxDayForMonth(data.month);
    if (data.dates.some((value) => value > maxDay)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dates"],
        message: "Selected date(s) are not valid for this month",
      });
    }
  });

const monthlySpecificDatesCleaningScheduleSchema = z
  .object({
    frequency: z.literal("monthly"),
    pattern_type: z.literal("specific_dates"),
    year: z.coerce.number().int().min(2000).max(3000).optional(),
    months: scheduleMonthsSchema,
    dates: z
      .array(z.coerce.number().int().min(1).max(31))
      .min(1, "Select at least one date")
      .optional(),
    month_dates: z.array(monthlyMonthDatesSchema).optional(),
    start_time: time24HourSchema,
    end_time: time24HourSchema,
  })
  .superRefine((data, ctx) => {
    const monthDates = Array.isArray(data.month_dates) ? data.month_dates : [];
    const hasMonthDates = monthDates.length > 0;
    const hasLegacyDates = Array.isArray(data.dates) && data.dates.length > 0;

    if (!hasMonthDates && !hasLegacyDates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["month_dates"],
        message: "Select at least one monthly date",
      });
    }

    if (data.months && new Set(data.months).size !== data.months.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["months"],
        message: "Months must be unique",
      });
    }

    if (hasMonthDates) {
      const monthValues = monthDates.map((entry) => entry.month);
      if (new Set(monthValues).size !== monthValues.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["month_dates"],
          message: "Month entries must be unique",
        });
      }

      const selectedMonths = data.months?.length ? data.months : monthValues;
      const missingMonths = selectedMonths.filter(
        (month) => !monthValues.includes(month)
      );
      if (missingMonths.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["month_dates"],
          message: "Each selected month must include at least one date",
        });
      }
    } else if (hasLegacyDates && data.dates) {
      if (new Set(data.dates).size !== data.dates.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dates"],
          message: "Dates must be unique",
        });
      }
      const maxDay = maxDayForMonths(data.months);
      if (data.dates.some((value) => value > maxDay)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dates"],
          message: "Selected date(s) are not valid for the selected month(s)",
        });
      }
    }

    if (toMinutes(data.end_time) <= toMinutes(data.start_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_time"],
        message: "End time must be after start time",
      });
    }
  });

const monthlyWeekdayPatternCleaningScheduleSchema = z
  .object({
    frequency: z.literal("monthly"),
    pattern_type: z.literal("weekday_pattern"),
    year: z.coerce.number().int().min(2000).max(3000).optional(),
    months: scheduleMonthsSchema,
    week: scheduleMonthWeekOptions,
    day: scheduleWeekdayOptions,
    start_time: time24HourSchema,
    end_time: time24HourSchema,
  })
  .superRefine((data, ctx) => {
    if (data.months && new Set(data.months).size !== data.months.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["months"],
        message: "Months must be unique",
      });
    }
    if (toMinutes(data.end_time) <= toMinutes(data.start_time)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_time"],
        message: "End time must be after start time",
      });
    }
  });

export const cleaningScheduleSchema = z.union([
  oneTimeCleaningScheduleSchema,
  weeklyCleaningScheduleSchema,
  monthlySpecificDatesCleaningScheduleSchema,
  monthlyWeekdayPatternCleaningScheduleSchema,
]);

const baseQuoteSchema = z.object({
  notes: z.string().max(500).optional(),
  services: serviceSelectionSchema.default({}),
  serviceDate: z
    .string()
    .regex(DATE_PATTERN, "Service date must be YYYY-MM-DD"),
  preferredTime: time24HourSchema,
  paymentFlow: z.enum(["checkout", "intent"]).optional(),
});

const baseServiceRequestSchema = z
  .object({
    companyName: z.string().trim().min(1).max(150),
    businessAddress: z.string().trim().min(3).max(250),
    preferredDate: z
      .string()
      .trim()
      .regex(DATE_PATTERN, "Preferred date must be YYYY-MM-DD")
      .optional(),
    preferredTime: time24HourSchema.optional(),
    cleaningSchedule: cleaningScheduleSchema.optional(),
    specialRequest: z.string().trim().max(500).optional(),
    totalPrice: z.coerce.number().min(0).optional(),
    cleanerPrice: z.coerce.number().min(0).optional(),
    squareFoot: z.coerce.number().positive().optional(),
    cleaningFrequency: cleaningFrequencyOptions.optional(),
    cleaningServices: z.array(cleaningServiceOptions).optional(),
    generalContractorName: z.string().trim().min(1).max(150).optional(),
    generalContractorPhone: z.string().trim().min(6).max(30).optional(),
    assignedCleanerIds: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    const hasLegacyDate = Boolean(data.preferredDate?.trim());
    const hasLegacyTime = Boolean(data.preferredTime?.trim());

    if (!data.cleaningSchedule && (!hasLegacyDate || !hasLegacyTime)) {
      if (!hasLegacyDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preferredDate"],
          message: "Preferred date is required when cleaningSchedule is not provided",
        });
      }
      if (!hasLegacyTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["preferredTime"],
          message: "Preferred time is required when cleaningSchedule is not provided",
        });
      }
    }

    if (data.cleaningSchedule && data.cleaningFrequency) {
      const frequencyFromSchedule =
        data.cleaningSchedule.frequency === "one_time"
          ? "one-time"
          : data.cleaningSchedule.frequency;
      if (frequencyFromSchedule !== data.cleaningFrequency) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cleaningFrequency"],
          message: "cleaningFrequency must match cleaningSchedule.frequency",
        });
      }
    }
  });

export const createAdminServiceRequestSchema = z.object({
  body: baseServiceRequestSchema.safeExtend({
    serviceType: z.enum(["commercial", "post_construction"]),
    name: fullNameSchema.optional(),
    email: z.string().email("Invalid email format").optional(),
    phoneNumber: z.string().trim().min(6).max(20).optional(),
    specialRequest: z.string().trim().min(1).max(500).optional(),
  }),
});

export const createQuoteGuestSchema = z.object({
  body: baseQuoteSchema.extend({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email("Invalid email format"),
    phoneNumber: z.string().min(6).max(20),
  }),
});

export const createQuoteAuthSchema = z.object({
  body: baseQuoteSchema.extend({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email("Invalid email format").optional(),
    phoneNumber: z.string().min(6).max(20).optional(),
  }),
});

const commercialRequirements = {
  cleaningServices: z
    .array(cleaningServiceOptions)
    .min(1, "Select at least one cleaning service"),
  cleaningFrequency: cleaningFrequencyOptions,
  squareFoot: z
    .coerce.number()
    .positive("Building size must be greater than zero"),
};

export const createServiceRequestGuestSchema = z.object({
  body: baseServiceRequestSchema.safeExtend({
    name: fullNameSchema,
    email: z.string().email("Invalid email format"),
    phoneNumber: z.string().trim().min(6).max(20),
  }),
});

export const createServiceRequestAuthSchema = z.object({
  body: baseServiceRequestSchema.safeExtend({
    name: fullNameSchema.optional(),
    email: z.string().email("Invalid email format").optional(),
    phoneNumber: z.string().trim().min(6).max(20).optional(),
  }),
});

export const createCommercialServiceRequestGuestSchema = z.object({
  body: createServiceRequestGuestSchema.shape.body.safeExtend(commercialRequirements),
});

export const createCommercialServiceRequestAuthSchema = z.object({
  body: createServiceRequestAuthSchema.shape.body.safeExtend(commercialRequirements),
});

export const createServiceRequestAdminSchema = z.object({
  body: baseServiceRequestSchema.safeExtend({
    serviceType: z.enum([
      QUOTE.SERVICE_TYPES.COMMERCIAL,
      QUOTE.SERVICE_TYPES.POST_CONSTRUCTION,
    ]),
    name: fullNameSchema,
    email: z.string().email("Invalid email format"),
    phoneNumber: z.string().trim().min(6).max(20),
  }),
});

export const updateQuoteStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      QUOTE.STATUSES.ADMIN_NOTIFIED,
      QUOTE.STATUSES.REVIEWED,
      QUOTE.STATUSES.CONTACTED,
      QUOTE.STATUSES.CLOSED,
    ]),
  }),
  params: z.object({
    quoteId: z.string().min(1),
  }),
});

export const assignQuoteCleanerSchema = z.object({
  body: z
    .object({
      cleanerId: z.string().min(1).optional(),
      cleanerIds: z.array(z.string().min(1)).min(1).optional(),
      cleanerSharePercentage: z.coerce.number().min(0).max(100).optional(),
    })
    .refine(
      (data) => Boolean(data.cleanerId || (data.cleanerIds && data.cleanerIds.length)),
      { message: "cleanerId or cleanerIds is required" },
    )
    .refine(
      (data) =>
        !data.cleanerIds ||
        data.cleanerIds.length <= 1 ||
        data.cleanerSharePercentage !== undefined,
      {
        message: "cleanerSharePercentage is required when assigning multiple cleaners",
        path: ["cleanerSharePercentage"],
      },
    ),
  params: z.object({
    quoteId: z.string().min(1),
  }),
});

export const confirmQuotePaymentSchema = z.object({
  body: z
    .object({
      paymentIntentId: z.string().min(1).optional(),
      checkoutSessionId: z.string().min(1).optional(),
      paymentMethodId: z.string().min(1).optional(),
    })
    .refine(
      (data) => Boolean(data.paymentIntentId || data.checkoutSessionId),
      {
        message: "paymentIntentId or checkoutSessionId is required",
        path: ["paymentIntentId"],
      },
    ),
});

export const quoteDetailSchema = z.object({
  params: z.object({
    quoteId: z.string().min(1),
  }),
  query: z.object({
    occurrenceDate: dateStringSchema.optional(),
  }),
});

export const adminQuoteNotificationListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    onlyUnread: booleanQueryParam,
  }),
});

export const adminQuoteNotificationDetailSchema = z.object({
  params: z.object({
    notificationId: z.string().trim().min(1),
  }),
});

export const bulkDeleteQuotesSchema = z.object({
  body: z.object({
    quoteIds: z.array(z.string().trim().min(1)).min(1),
  }),
});

export const quotePaymentStatusSchema = z.object({
  query: z
    .object({
      paymentIntentId: z.string().min(1).optional(),
      checkoutSessionId: z.string().min(1).optional(),
    })
    .refine(
      (data) => Boolean(data.paymentIntentId || data.checkoutSessionId),
      {
        message: "paymentIntentId or checkoutSessionId is required",
        path: ["paymentIntentId"],
      },
    ),
});
