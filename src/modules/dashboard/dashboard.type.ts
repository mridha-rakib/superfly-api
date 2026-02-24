export type EarningsPoint = {
  label: string;
  amount: number;
};

export type DashboardStats = {
  totalBookings: number;
  activeCleaners: number;
  totalRevenue: number;
};

export type DashboardEarnings = {
  daily: EarningsPoint[];
  weekly: EarningsPoint[];
  monthly: EarningsPoint[];
  yearly: EarningsPoint[];
};

export type DashboardBookingRow = {
  id: string;
  rawId?: string;
  customer: string;
  service: string;
  date: string;
  status: "Complete" | "In Progress" | "Pending";
  amount: number;
};

export type DashboardOverview = {
  stats: DashboardStats;
  earnings: DashboardEarnings;
  recentBookings: DashboardBookingRow[];
};

export type EarningsAnalyticsSummary = {
  totalEarnings: number;
  paidEarnings: number;
  outstandingEarnings: number;
  cleanerEarnings: number;
  adminEarnings: number;
  totalRecords: number;
  totalBookings: number;
  totalQuotes: number;
};

export type ServiceEarningsRow = {
  serviceType: "Residential" | "Commercial" | "Post-Construction";
  jobs: number;
  totalEarnings: number;
  paidEarnings: number;
  cleanerEarnings: number;
  adminEarnings: number;
  averageEarning: number;
};

export type CleanerEarningsRow = {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail?: string;
  jobs: number;
  totalEarnings: number;
  averageEarning: number;
};

export type EarningsBookingWiseRow = {
  id: string;
  rawId: string;
  recordType: "Booking" | "Quote";
  customer: string;
  service: "Residential" | "Commercial" | "Post-Construction";
  frequency: string;
  status: string;
  paymentStatus: string;
  date: string;
  preferredTime?: string;
  totalAmount: number;
  cleanerAmount: number;
  adminAmount: number;
  cleanerCount: number;
};

export type DashboardPagination = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
};

export type DashboardEarningsAnalytics = {
  summary: EarningsAnalyticsSummary;
  serviceWise: ServiceEarningsRow[];
  cleanerWise: CleanerEarningsRow[];
  bookingWise: {
    rows: EarningsBookingWiseRow[];
    pagination: DashboardPagination;
  };
};

export type DashboardEarningsAnalyticsQuery = {
  page: number;
  limit: number;
  search?: string;
  serviceType?: string;
};
