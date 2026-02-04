import { ACCOUNT_STATUS, QUOTE, ROLES } from "@/constants/app.constants";
import type { IQuote } from "@/modules/quote/quote.interface";
import { Quote } from "@/modules/quote/quote.model";
import { User } from "@/modules/user/user.model";
import type {
  DashboardBookingRow,
  DashboardOverview,
  EarningsPoint,
} from "./dashboard.type";

const TIME_ZONE = "UTC";
const DAY_MS = 24 * 60 * 60 * 1000;

type AggregateRow = { _id: string; total: number };

const roundAmount = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const startOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDaysUtc = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);

const startOfWeekUtc = (date: Date) => {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  return addDaysUtc(startOfDayUtc(date), -diff);
};

const startOfMonthUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const toMonthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

const formatWeekday = (date: Date) =>
  date.toLocaleDateString("en-US", { weekday: "short", timeZone: TIME_ZONE });

const formatMonth = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", timeZone: TIME_ZONE });

const formatDayMonth = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: TIME_ZONE,
  });

const parseDate = (value?: string | Date | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const mapServiceLabel = (serviceType?: string) => {
  const normalized = (serviceType || "").toLowerCase();
  if (normalized === QUOTE.SERVICE_TYPES.COMMERCIAL) return "Commercial";
  if (normalized === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION) return "Post-Construction";
  return "Residential";
};

const buildBookingId = (serviceType: string, rawId: string) => {
  const normalized = (serviceType || "").toLowerCase();
  const prefix =
    normalized === QUOTE.SERVICE_TYPES.COMMERCIAL
      ? "COM"
      : normalized === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION
        ? "POST"
        : "RES";
  const suffix = rawId ? rawId.slice(-6).toUpperCase() : "XXXXXX";
  return `#${prefix}-${suffix}`;
};

const mapBookingStatus = (quote: IQuote) => {
  if (quote.reportStatus === QUOTE.REPORT_STATUSES.APPROVED) {
    return "Complete";
  }
  if (
    quote.status === QUOTE.STATUSES.COMPLETED ||
    quote.status === QUOTE.STATUSES.REVIEWED
  ) {
    return "Complete";
  }
  if (quote.cleaningStatus === QUOTE.CLEANING_STATUSES.COMPLETED) {
    return "Complete";
  }
  if (quote.cleaningStatus === QUOTE.CLEANING_STATUSES.IN_PROGRESS) {
    return "In Progress";
  }
  return "Pending";
};

const resolveCustomerName = (quote: IQuote) => {
  const name =
    quote.companyName ||
    quote.contactName ||
    [quote.firstName, quote.lastName].filter(Boolean).join(" ");
  return name || quote.email || "Client";
};

const resolveAmount = (quote: IQuote) => {
  if (typeof quote.totalPrice === "number" && !Number.isNaN(quote.totalPrice)) {
    return quote.totalPrice;
  }
  if (
    typeof quote.paymentAmount === "number" &&
    !Number.isNaN(quote.paymentAmount)
  ) {
    return quote.paymentAmount / 100;
  }
  return 0;
};

export class DashboardService {
  async getOverview(): Promise<DashboardOverview> {
    const now = new Date();
    const todayStart = startOfDayUtc(now);
    const weekStart = startOfWeekUtc(now);
    const weekEnd = addDaysUtc(weekStart, 7);
    const monthStart = startOfMonthUtc(now);

    const dailyStart = addDaysUtc(todayStart, -27);
    const monthRangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)
    );
    const yearRangeStart = new Date(Date.UTC(now.getUTCFullYear() - 3, 0, 1));

    const [
      totalBookings,
      activeCleaners,
      totalRevenue,
      dailyRows,
      monthlyRows,
      yearlyRows,
      recentQuotes,
    ] = await Promise.all([
      Quote.countDocuments({
        isDeleted: { $ne: true },
        createdAt: { $gte: weekStart, $lt: weekEnd },
      }),
      User.countDocuments({
        role: ROLES.CLEANER,
        accountStatus: ACCOUNT_STATUS.ACTIVE,
        isDeleted: { $ne: true },
      }),
      this.sumRevenue(monthStart, now),
      this.aggregateRevenueByDate(dailyStart, now, "%Y-%m-%d"),
      this.aggregateRevenueByDate(monthRangeStart, now, "%Y-%m"),
      this.aggregateRevenueByDate(yearRangeStart, now, "%Y"),
      Quote.find({ isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean<IQuote[]>(),
    ]);

    const dailyMap = new Map<string, number>();
    dailyRows.forEach((row) => {
      dailyMap.set(row._id, row.total || 0);
    });

    const monthlyMap = new Map<string, number>();
    monthlyRows.forEach((row) => {
      monthlyMap.set(row._id, row.total || 0);
    });

    const yearlyMap = new Map<string, number>();
    yearlyRows.forEach((row) => {
      yearlyMap.set(row._id, row.total || 0);
    });

    const daily: EarningsPoint[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = addDaysUtc(todayStart, -i);
      const key = toDateKey(date);
      daily.push({
        label: formatWeekday(date),
        amount: roundAmount(dailyMap.get(key) || 0),
      });
    }

    const weekly: EarningsPoint[] = [];
    const currentWeekStart = startOfWeekUtc(now);
    const weekStarts: Date[] = [];
    for (let i = 3; i >= 0; i -= 1) {
      weekStarts.push(addDaysUtc(currentWeekStart, -7 * i));
    }
    weekStarts.forEach((start, index) => {
      let total = 0;
      for (let day = 0; day < 7; day += 1) {
        const key = toDateKey(addDaysUtc(start, day));
        total += dailyMap.get(key) || 0;
      }
      weekly.push({
        label: `Week ${index + 1}`,
        amount: roundAmount(total),
      });
    });

    const monthly: EarningsPoint[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)
      );
      const key = toMonthKey(date);
      monthly.push({
        label: formatMonth(date),
        amount: roundAmount(monthlyMap.get(key) || 0),
      });
    }

    const yearly: EarningsPoint[] = [];
    for (let i = 3; i >= 0; i -= 1) {
      const year = now.getUTCFullYear() - i;
      const key = `${year}`;
      yearly.push({
        label: key,
        amount: roundAmount(yearlyMap.get(key) || 0),
      });
    }

    const recentBookings = this.buildRecentBookings(recentQuotes || []);

    return {
      stats: {
        totalBookings: totalBookings || 0,
        activeCleaners: activeCleaners || 0,
        totalRevenue: roundAmount(totalRevenue || 0),
      },
      earnings: {
        daily,
        weekly,
        monthly,
        yearly,
      },
      recentBookings,
    };
  }

  private async aggregateRevenueByDate(
    start: Date,
    end: Date,
    format: string
  ): Promise<AggregateRow[]> {
    return Quote.aggregate<AggregateRow>([
      {
        $match: {
          isDeleted: { $ne: true },
          paymentStatus: "paid",
        },
      },
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$paidAt", "$createdAt"] },
          revenueAmount: {
            $ifNull: [
              "$totalPrice",
              { $ifNull: [{ $divide: ["$paymentAmount", 100] }, 0] },
            ],
          },
        },
      },
      {
        $match: {
          effectiveDate: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format,
              date: "$effectiveDate",
              timezone: TIME_ZONE,
            },
          },
          total: { $sum: "$revenueAmount" },
        },
      },
    ]).exec();
  }

  private async sumRevenue(start: Date, end: Date): Promise<number> {
    const results = await Quote.aggregate<{ total: number }>([
      {
        $match: {
          isDeleted: { $ne: true },
          paymentStatus: "paid",
        },
      },
      {
        $addFields: {
          effectiveDate: { $ifNull: ["$paidAt", "$createdAt"] },
          revenueAmount: {
            $ifNull: [
              "$totalPrice",
              { $ifNull: [{ $divide: ["$paymentAmount", 100] }, 0] },
            ],
          },
        },
      },
      {
        $match: {
          effectiveDate: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$revenueAmount" },
        },
      },
    ]).exec();

    return results?.[0]?.total || 0;
  }

  private buildRecentBookings(quotes: IQuote[]): DashboardBookingRow[] {
    return quotes.map((quote) => {
      const rawId = quote._id?.toString?.() || "";
      const serviceLabel = mapServiceLabel(quote.serviceType);
      const displayId = buildBookingId(quote.serviceType, rawId);
      const customer = resolveCustomerName(quote);
      const amount = resolveAmount(quote);
      const serviceDate = parseDate(quote.serviceDate);
      const createdAt = parseDate(quote.createdAt);
      const displayDate = formatDayMonth(serviceDate || createdAt || new Date());

      return {
        id: displayId,
        rawId,
        customer,
        service: serviceLabel,
        date: displayDate,
        status: mapBookingStatus(quote),
        amount: roundAmount(amount),
      };
    });
  }
}
