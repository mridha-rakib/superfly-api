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
