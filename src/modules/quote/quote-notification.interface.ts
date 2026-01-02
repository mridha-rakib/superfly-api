import type { Document, Types } from "mongoose";
import type { QuoteServiceType } from "./quote.interface";

export type QuoteNotificationEvent = "quote_submitted";

export type QuoteNotificationCreatePayload = {
  quoteId: Types.ObjectId | string;
  event: QuoteNotificationEvent;
  serviceType: QuoteServiceType;
  clientName: string;
  companyName?: string;
  email: string;
  phoneNumber: string;
  businessAddress?: string;
  serviceDate: string;
  preferredTime?: string;
  requestedServices: string[];
  notes?: string;
};

export interface IQuoteNotification extends Document {
  _id: Types.ObjectId;
  quoteId: Types.ObjectId | string;
  event: QuoteNotificationEvent;
  serviceType: QuoteServiceType;
  clientName: string;
  companyName?: string;
  email: string;
  phoneNumber: string;
  businessAddress?: string;
  serviceDate: string;
  preferredTime?: string;
  requestedServices: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
