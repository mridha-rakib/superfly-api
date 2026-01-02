import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { IQuoteNotification } from "./quote-notification.interface";

const quoteNotificationSchema = BaseSchemaUtil.createSchema<IQuoteNotification>({
  quoteId: {
    type: Schema.Types.ObjectId,
    ref: "Quote",
    required: true,
    index: true,
  },
  event: {
    type: String,
    required: true,
    default: "quote_submitted",
  },
  serviceType: {
    type: String,
    required: true,
  },
  clientName: {
    type: String,
    required: true,
    trim: true,
  },
  companyName: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
  },
  businessAddress: {
    type: String,
    trim: true,
  },
  serviceDate: {
    type: String,
    required: true,
  },
  preferredTime: {
    type: String,
    trim: true,
  },
  requestedServices: {
    type: [String],
    default: [],
  },
  notes: {
    type: String,
    trim: true,
  },
});

quoteNotificationSchema.index({ quoteId: 1, event: 1 }, { unique: true });

export const QuoteNotification = model<IQuoteNotification>(
  "QuoteNotification",
  quoteNotificationSchema
);
