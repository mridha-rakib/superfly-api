import { ACCOUNT_STATUS, QUOTE, ROLES } from "@/constants/app.constants";
import type { IQuote } from "@/modules/quote/quote.interface";
import { Quote } from "@/modules/quote/quote.model";
import { User } from "@/modules/user/user.model";
import type {
  CleanerEarningsRow,
  DashboardEarningsAnalytics,
  DashboardEarningsAnalyticsQuery,
  DashboardBookingRow,
  DashboardOverview,
  EarningsBookingWiseRow,
  EarningsPoint,
  ServiceEarningsRow,
} from "./dashboard.type";

const TIME_ZONE = "UTC";
const DAY_MS = 24 * 60 * 60 * 1000;

type AggregateRow = { _id: string; total: number };
type ServiceLabel = "Residential" | "Commercial" | "Post-Construction";
type CleanerRow = {
  _id: { toString(): string };
  fullName?: string;
  email?: string;
};

const roundAmount = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

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

const mapServiceLabel = (serviceType?: string): ServiceLabel => {
  const normalized = (serviceType || "").toLowerCase();
  if (normalized === QUOTE.SERVICE_TYPES.COMMERCIAL) return "Commercial";
  if (normalized === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION) return "Post-Construction";
  return "Residential";
};

const serviceLabels: ServiceLabel[] = [
  "Residential",
  "Commercial",
  "Post-Construction",
];

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
    quote.status === QUOTE.STATUSES.CLOSED ||
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

const resolveCleanerIds = (quote: IQuote): string[] => {
  return Array.from(
    new Set([
      ...(quote.assignedCleanerIds || []).map((id) => id.toString()),
      quote.assignedCleanerId ? quote.assignedCleanerId.toString() : "",
    ]),
  ).filter(Boolean);
};

const resolveCleanerTotalAmount = (quote: IQuote, totalAmount: number): number => {
  if (isFiniteNumber(quote.cleanerEarningAmount)) {
    return Math.max(0, quote.cleanerEarningAmount);
  }

  if (totalAmount <= 0) {
    return 0;
  }

  const cleanerCount = resolveCleanerIds(quote).length;
  const sharePercentage = isFiniteNumber(quote.cleanerSharePercentage)
    ? quote.cleanerSharePercentage
    : isFiniteNumber(quote.cleanerPercentage)
      ? quote.cleanerPercentage * Math.max(cleanerCount, 1)
      : 0;

  if (sharePercentage <= 0) {
    return 0;
  }

  return (totalAmount * sharePercentage) / 100;
};

const resolvePerCleanerAmount = (
  quote: IQuote,
  totalAmount: number,
  cleanerTotal: number,
  cleanerCount: number,
): number => {
  if (cleanerCount <= 0) {
    return 0;
  }

  if (isFiniteNumber(quote.cleanerPercentage) && totalAmount > 0) {
    return Math.max(0, (totalAmount * quote.cleanerPercentage) / 100);
  }

  if (cleanerTotal <= 0) {
    return 0;
  }

  return cleanerTotal / cleanerCount;
};

const resolveAdminAmount = (totalAmount: number, cleanerAmount: number): number =>
  Math.max(0, totalAmount - cleanerAmount);

const formatFrequency = (value?: string) => {
  const normalized = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  if (normalized === "weekly") return "Weekly";
  if (normalized === "monthly") return "Monthly";
  if (normalized === "daily") return "Daily";
  return "One Time";
};

const formatStatusLabel = (value?: string) => {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return "Pending";
  }

  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const normalizeServiceFilter = (value?: string) => {
  const normalized = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");

  if (normalized === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
    return QUOTE.SERVICE_TYPES.RESIDENTIAL;
  }
  if (normalized === QUOTE.SERVICE_TYPES.COMMERCIAL) {
    return QUOTE.SERVICE_TYPES.COMMERCIAL;
  }
  if (normalized === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION) {
    return QUOTE.SERVICE_TYPES.POST_CONSTRUCTION;
  }

  return undefined;
};

const isLikelyBooking = (quote: IQuote) => {
  if ((quote.paymentStatus || "").toLowerCase() === "paid") {
    return true;
  }

  const status = (quote.status || "").toLowerCase();
  return (
    status === QUOTE.STATUSES.PAID ||
    status === QUOTE.STATUSES.REVIEWED ||
    status === QUOTE.STATUSES.CONTACTED ||
    status === QUOTE.STATUSES.CLOSED ||
    status === QUOTE.STATUSES.COMPLETED
  );
};

const toSearchText = (row: EarningsBookingWiseRow) =>
  [
    row.id,
    row.rawId,
    row.customer,
    row.service,
    row.recordType,
    row.status,
    row.paymentStatus,
    row.frequency,
    row.date,
  ]
    .join(" ")
    .toLowerCase();

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

  async getEarningsAnalytics(
    query: DashboardEarningsAnalyticsQuery,
  ): Promise<DashboardEarningsAnalytics> {
    const requestedPage =
      Number.isFinite(query.page) && query.page > 0 ? Math.floor(query.page) : 1;
    const limit = Number.isFinite(query.limit)
      ? Math.min(Math.max(Math.floor(query.limit), 1), 100)
      : 10;
    const search = query.search?.trim().toLowerCase();
    const serviceTypeFilter = normalizeServiceFilter(query.serviceType);

    const quotes = await Quote.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .select(
        "_id serviceType status paymentStatus createdAt serviceDate preferredTime cleaningFrequency companyName contactName firstName lastName email totalPrice paymentAmount cleanerEarningAmount cleanerSharePercentage cleanerPercentage assignedCleanerId assignedCleanerIds",
      )
      .lean<IQuote[]>();

    const filteredQuotes = serviceTypeFilter
      ? quotes.filter((quote) => quote.serviceType === serviceTypeFilter)
      : quotes;

    const earningQuotes = filteredQuotes.filter((quote) => resolveAmount(quote) > 0);

    const summaryBase = {
      totalEarnings: 0,
      paidEarnings: 0,
      cleanerEarnings: 0,
      adminEarnings: 0,
    };

    const serviceAccumulator = new Map<
      ServiceLabel,
      {
        jobs: number;
        totalEarnings: number;
        paidEarnings: number;
        cleanerEarnings: number;
        adminEarnings: number;
      }
    >();

    serviceLabels.forEach((label) => {
      serviceAccumulator.set(label, {
        jobs: 0,
        totalEarnings: 0,
        paidEarnings: 0,
        cleanerEarnings: 0,
        adminEarnings: 0,
      });
    });

    for (const quote of earningQuotes) {
      const totalAmount = resolveAmount(quote);
      const cleanerAmount = resolveCleanerTotalAmount(quote, totalAmount);
      const adminAmount = resolveAdminAmount(totalAmount, cleanerAmount);
      const serviceLabel = mapServiceLabel(quote.serviceType);
      const serviceStat = serviceAccumulator.get(serviceLabel);
      const paidAmount = (quote.paymentStatus || "").toLowerCase() === "paid"
        ? totalAmount
        : 0;

      summaryBase.totalEarnings += totalAmount;
      summaryBase.paidEarnings += paidAmount;
      summaryBase.cleanerEarnings += cleanerAmount;
      summaryBase.adminEarnings += adminAmount;

      if (serviceStat) {
        serviceStat.jobs += 1;
        serviceStat.totalEarnings += totalAmount;
        serviceStat.paidEarnings += paidAmount;
        serviceStat.cleanerEarnings += cleanerAmount;
        serviceStat.adminEarnings += adminAmount;
      }
    }

    const serviceWise: ServiceEarningsRow[] = serviceLabels.map((label) => {
      const stat = serviceAccumulator.get(label);
      const jobs = stat?.jobs || 0;
      const totalEarnings = stat?.totalEarnings || 0;

      return {
        serviceType: label,
        jobs,
        totalEarnings: roundAmount(totalEarnings),
        paidEarnings: roundAmount(stat?.paidEarnings || 0),
        cleanerEarnings: roundAmount(stat?.cleanerEarnings || 0),
        adminEarnings: roundAmount(stat?.adminEarnings || 0),
        averageEarning: roundAmount(jobs > 0 ? totalEarnings / jobs : 0),
      };
    });

    const cleanerIds = Array.from(
      new Set(earningQuotes.flatMap((quote) => resolveCleanerIds(quote))),
    );

    const cleaners = cleanerIds.length
      ? await User.find({
        _id: { $in: cleanerIds },
        role: ROLES.CLEANER,
        isDeleted: { $ne: true },
      })
        .select("_id fullName email")
        .lean<CleanerRow[]>()
      : [];

    const cleanerIdentityMap = new Map<string, { name: string; email?: string }>();
    cleaners.forEach((cleaner) => {
      const cleanerId = cleaner._id.toString();
      cleanerIdentityMap.set(cleanerId, {
        name: cleaner.fullName || "Cleaner",
        email: cleaner.email,
      });
    });

    const cleanerAccumulator = new Map<string, { jobs: number; total: number }>();
    for (const quote of earningQuotes) {
      const assignedCleanerIds = resolveCleanerIds(quote);
      if (!assignedCleanerIds.length) {
        continue;
      }

      const totalAmount = resolveAmount(quote);
      const cleanerAmount = resolveCleanerTotalAmount(quote, totalAmount);
      const perCleanerAmount = resolvePerCleanerAmount(
        quote,
        totalAmount,
        cleanerAmount,
        assignedCleanerIds.length,
      );

      assignedCleanerIds.forEach((cleanerId) => {
        const existing = cleanerAccumulator.get(cleanerId) || {
          jobs: 0,
          total: 0,
        };

        existing.jobs += 1;
        existing.total += perCleanerAmount;
        cleanerAccumulator.set(cleanerId, existing);
      });
    }

    const cleanerWise: CleanerEarningsRow[] = Array.from(cleanerAccumulator.entries())
      .map(([cleanerId, stats]) => {
        const identity = cleanerIdentityMap.get(cleanerId);
        const jobs = stats.jobs || 0;
        const total = stats.total || 0;

        return {
          cleanerId,
          cleanerName: identity?.name || "Cleaner",
          cleanerEmail: identity?.email,
          jobs,
          totalEarnings: roundAmount(total),
          averageEarning: roundAmount(jobs > 0 ? total / jobs : 0),
        };
      })
      .sort((a, b) => b.totalEarnings - a.totalEarnings);

    const allRows: EarningsBookingWiseRow[] = earningQuotes.map((quote) => {
      const rawId = quote._id?.toString?.() || "";
      const totalAmount = resolveAmount(quote);
      const cleanerAmount = resolveCleanerTotalAmount(quote, totalAmount);
      const adminAmount = resolveAdminAmount(totalAmount, cleanerAmount);
      const serviceDate = parseDate(quote.serviceDate);
      const createdAt = parseDate(quote.createdAt);
      const displayDate = formatDayMonth(serviceDate || createdAt || new Date());
      const cleanerCount = resolveCleanerIds(quote).length;

      return {
        id: buildBookingId(quote.serviceType, rawId),
        rawId,
        recordType: isLikelyBooking(quote) ? "Booking" : "Quote",
        customer: resolveCustomerName(quote),
        service: mapServiceLabel(quote.serviceType),
        frequency: formatFrequency(quote.cleaningFrequency),
        status: formatStatusLabel(quote.status),
        paymentStatus: formatStatusLabel(quote.paymentStatus),
        date: displayDate,
        preferredTime: quote.preferredTime,
        totalAmount: roundAmount(totalAmount),
        cleanerAmount: roundAmount(cleanerAmount),
        adminAmount: roundAmount(adminAmount),
        cleanerCount,
      };
    });

    const searchedRows = search
      ? allRows.filter((row) => toSearchText(row).includes(search))
      : allRows;

    const totalItems = searchedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const page = Math.min(requestedPage, totalPages);
    const startIndex = (page - 1) * limit;
    const pagedRows = searchedRows.slice(startIndex, startIndex + limit);

    const totalRecords = earningQuotes.length;
    const totalBookings = earningQuotes.filter((quote) => isLikelyBooking(quote)).length;
    const totalQuotes = Math.max(totalRecords - totalBookings, 0);

    return {
      summary: {
        totalEarnings: roundAmount(summaryBase.totalEarnings),
        paidEarnings: roundAmount(summaryBase.paidEarnings),
        outstandingEarnings: roundAmount(
          Math.max(summaryBase.totalEarnings - summaryBase.paidEarnings, 0),
        ),
        cleanerEarnings: roundAmount(summaryBase.cleanerEarnings),
        adminEarnings: roundAmount(summaryBase.adminEarnings),
        totalRecords,
        totalBookings,
        totalQuotes,
      },
      serviceWise,
      cleanerWise,
      bookingWise: {
        rows: pagedRows,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages,
        },
      },
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
