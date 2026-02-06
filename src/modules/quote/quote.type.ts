import type {
  QuoteCleaningStatus,
  QuoteReportStatus,
  QuoteServiceType,
  QuoteStatus,
} from "./quote.interface";
import type { CleaningReportStatus } from "@/modules/cleaning-report/cleaning-report.interface";

export type QuoteServiceSelection = Record<string, number | undefined>;
export type QuotePaymentStatus = "pending" | "paid" | "failed";

export type QuoteServiceItem = {
  key: string;
  label: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type QuoteCreatePayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  serviceDate: string;
  preferredTime: string;
  notes?: string;
  services: QuoteServiceSelection;
  paymentFlow?: "checkout" | "intent";
};

export type QuoteRequestPayload = {
  serviceType: QuoteServiceType;
  name?: string;
  companyName: string;
  email?: string;
  phoneNumber?: string;
  businessAddress: string;
  preferredDate: string;
  preferredTime: string;
  specialRequest: string;
  totalPrice?: number;
  cleanerPrice?: number;
  squareFoot?: number;
  cleaningFrequency?: string;
  cleaningServices?: string[];
  generalContractorName?: string;
  generalContractorPhone?: string;
  assignedCleanerIds?: string[];
};

export type QuoteStatusUpdatePayload = {
  status: QuoteStatus;
};

export type QuoteAssignCleanerPayload = {
  cleanerId?: string;
  cleanerIds?: string[];
  cleanerSharePercentage?: number;
};

export type QuoteResponse = {
  _id: string;
  userId?: string;
  createdByRole?: string;
  serviceType: QuoteServiceType;
  status?: QuoteStatus;
  clientStatus?: string;
  cleanerStatus?: string;
  adminStatus?: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  email: string;
  phoneNumber: string;
  companyName?: string;
  businessAddress?: string;
  serviceDate: string;
  preferredTime?: string;
  notes?: string;
  services?: QuoteServiceItem[];
  totalPrice?: number;
  currency?: string;
  paymentIntentId?: string;
  paymentAmount?: number;
  paymentStatus?: "pending" | "paid" | "failed" | "unpaid" | "completed" | "manual";
  paidAt?: Date;
  adminNotifiedAt?: Date;
  assignedCleanerId?: string;
  assignedCleanerIds?: string[];
  assignedCleaners?: Array<{
    _id: string;
    fullName?: string;
    email?: string;
    phone?: string;
  }>;
  assignedCleanerAt?: Date;
  cleaningStatus?: QuoteCleaningStatus;
  reportStatus?: QuoteReportStatus;
  reportSubmittedBy?: string;
  reportSubmittedAt?: Date;
  cleanerSharePercentage?: number;
  cleanerPercentage?: number;
  cleanerEarningAmount?: number;
  squareFoot?: number;
  cleaningFrequency?: string;
  cleaningServices?: string[];
  generalContractorName?: string;
  generalContractorPhone?: string;
  createdAt: Date;
  updatedAt: Date;
  cleaningReport?: QuoteCleaningReportSummary;
  clientAddress?: string;
};

export type QuotePaymentIntentResponse = {
  flow: "checkout" | "intent";
  paymentIntentId?: string;
  clientSecret?: string;
  checkoutUrl?: string;
  sessionId?: string;
  amount: number;
  currency: string;
};

export type QuotePaymentStatusResponse = {
  status: QuotePaymentStatus;
  paymentIntentId?: string;
  checkoutSessionId?: string;
  quoteId?: string;
  stripeStatus?: string;
  serviceDate?: string;
  preferredTime?: string;
  paymentAmount?: number;
  currency?: string;
};

export type QuoteCleaningReportSummary = {
  arrivalTime: Date;
  startTime: Date;
  endTime: Date;
  notes?: string;
  beforePhotos: string[];
  afterPhotos: string[];
  status: CleaningReportStatus;
  createdAt: Date;
};
