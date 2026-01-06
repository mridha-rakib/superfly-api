import type { QuoteServiceType, QuoteStatus } from "./quote.interface";

export type QuoteServiceSelection = Record<string, number | undefined>;

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
  notes?: string;
  services: QuoteServiceSelection;
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
};

export type QuoteStatusUpdatePayload = {
  status: QuoteStatus;
};

export type QuoteAssignCleanerPayload = {
  cleanerId: string;
};

export type QuoteResponse = {
  _id: string;
  userId?: string;
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
  services?: QuoteServiceItem[];
  totalPrice?: number;
  currency?: string;
  paymentIntentId?: string;
  paymentAmount?: number;
  paymentStatus?: "paid";
  paidAt?: Date;
  adminNotifiedAt?: Date;
  assignedCleanerId?: string;
  assignedCleanerAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type QuotePaymentIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
};
