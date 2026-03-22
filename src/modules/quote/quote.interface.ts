import type { Document, Types } from "mongoose";
import type { QuoteCleaningSchedule } from "./quote-schedule.type";

export type QuoteServiceType =
  | "residential"
  | "commercial"
  | "post_construction";

export type QuoteStatus =
  | "submitted"
  | "admin_notified"
  | "reviewed"
  | "contacted"
  | "paid"
  | "closed"
  | "completed";

export type QuoteCleaningStatus =
  | "pending"
  | "cleaning_in_progress"
  | "completed";

export type QuoteReportStatus = "pending" | "approved";
export type QuoteCleanerPaymentStatus = "pending" | "paid";

export interface IQuoteServiceItem {
  key: string;
  label: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface IQuoteCleanerProgress {
  cleanerId: Types.ObjectId | string;
  cleaningStatus?: QuoteCleaningStatus;
  reportStatus?: QuoteReportStatus;
  reportId?: Types.ObjectId | string;
  reportSubmittedAt?: Date;
  reportApprovedAt?: Date;
  arrivalMarkedAt?: Date;
  paymentStatus?: QuoteCleanerPaymentStatus;
  paidAt?: Date;
  cleanerPercentage?: number;
  cleanerEarningAmount?: number;
}

export interface IQuoteCleanerOccurrenceProgress {
  cleanerId: Types.ObjectId | string;
  occurrenceDate: string;
  cleaningStatus?: QuoteCleaningStatus;
  reportStatus?: QuoteReportStatus;
  reportId?: Types.ObjectId | string;
  reportSubmittedAt?: Date;
  reportApprovedAt?: Date;
  arrivalMarkedAt?: Date;
  paymentStatus?: QuoteCleanerPaymentStatus;
  paidAt?: Date;
  cleanerPercentage?: number;
  cleanerEarningAmount?: number;
}

export interface IQuote extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId | string;
  createdByRole?: string;
  serviceType: QuoteServiceType;
  status?: QuoteStatus;
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
  squareFoot?: number;
  cleaningFrequency?: string;
  cleaningSchedule?: QuoteCleaningSchedule;
  cleaningServices?: string[];
  generalContractorName?: string;
  generalContractorPhone?: string;
  services?: IQuoteServiceItem[];
  totalPrice?: number;
  currency?: string;
  paymentIntentId?: string;
  paymentAmount?: number;
  paymentStatus?: "pending" | "paid" | "failed" | "unpaid" | "completed" | "manual";
  paidAt?: Date;
  adminNotifiedAt?: Date;
  assignedCleanerIds?: Array<Types.ObjectId | string>;
  assignedCleanerId?: Types.ObjectId | string;
  assignedCleanerAt?: Date;
  cleaningStatus?: QuoteCleaningStatus;
  reportStatus?: QuoteReportStatus;
  reportSubmittedBy?: Types.ObjectId | string;
  reportSubmittedAt?: Date;
  /**
   * Total percentage of the quote amount that should be shared across all assigned cleaners.
   * The per-cleaner share is derived from this value divided by the number of cleaners.
   */
  cleanerSharePercentage?: number;
  cleanerPercentage?: number;
  cleanerEarningAmount?: number;
  cleanerProgress?: IQuoteCleanerProgress[];
  cleanerOccurrenceProgress?: IQuoteCleanerOccurrenceProgress[];
  isDeleted?: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IQuotePaymentDraft extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId | string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  serviceDate: string;
  preferredTime: string;
  notes?: string;
  services: IQuoteServiceItem[];
  totalPrice: number;
  currency: string;
  paymentIntentId?: string;
  stripeSessionId?: string;
  paymentAmount: number;
  paymentStatus: "pending" | "completed";
  quoteId?: Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}
