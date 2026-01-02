import type { Document, Types } from "mongoose";

export type QuoteServiceType =
  | "residential"
  | "commercial"
  | "post_construction";

export type QuoteStatus =
  | "submitted"
  | "admin_notified"
  | "reviewed"
  | "contacted"
  | "paid";

export interface IQuoteServiceItem {
  key: string;
  label: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface IQuote extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId | string;
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
  services?: IQuoteServiceItem[];
  totalPrice?: number;
  currency?: string;
  paymentIntentId?: string;
  paymentAmount?: number;
  paymentStatus?: "paid";
  paidAt?: Date;
  adminNotifiedAt?: Date;
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
  notes?: string;
  services: IQuoteServiceItem[];
  totalPrice: number;
  currency: string;
  paymentIntentId: string;
  paymentAmount: number;
  paymentStatus: "pending" | "completed";
  quoteId?: Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}
