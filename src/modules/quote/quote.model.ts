import { QUOTE } from "@/constants/app.constants";
import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { IQuote } from "./quote.interface";

const quoteSchema = BaseSchemaUtil.createSchema<IQuote>({
  ...BaseSchemaUtil.softDeleteFields(),
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    index: true,
  },
  serviceType: {
    type: String,
    required: true,
    enum: Object.values(QUOTE.SERVICE_TYPES),
    default: QUOTE.SERVICE_TYPES.RESIDENTIAL,
    index: true,
  },
  status: {
    type: String,
    enum: Object.values(QUOTE.STATUSES),
    index: true,
  },
  contactName: {
    type: String,
    trim: true,
  },
  firstName: {
    type: String,
    trim: true,
  },
  lastName: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
  },
  companyName: {
    type: String,
    trim: true,
  },
  businessAddress: {
    type: String,
    trim: true,
  },
  serviceDate: {
    type: String,
    required: true,
    index: true,
  },
  preferredTime: {
    type: String,
    trim: true,
  },
  notes: {
    type: String,
    trim: true,
  },
  services: [
    {
      key: { type: String, required: true },
      label: { type: String, required: true },
      unitPrice: { type: Number, required: true, min: 0 },
      quantity: { type: Number, required: true, min: 0 },
      subtotal: { type: Number, required: true, min: 0 },
    },
  ],
  currency: {
    type: String,
  },
  totalPrice: {
    type: Number,
    min: 0,
  },
  paymentIntentId: {
    type: String,
    index: true,
  },
  paymentAmount: {
    type: Number,
    min: 0,
  },
  paymentStatus: {
    type: String,
  },
  paidAt: {
    type: Date,
  },
  adminNotifiedAt: {
    type: Date,
  },
  assignedCleanerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    index: true,
  },
  assignedCleanerAt: {
    type: Date,
  },
  cleaningStatus: {
    type: String,
    enum: Object.values(QUOTE.CLEANING_STATUSES),
    default: QUOTE.CLEANING_STATUSES.PENDING,
    index: true,
  },
  reportStatus: {
    type: String,
    enum: Object.values(QUOTE.REPORT_STATUSES),
    index: true,
  },
});

quoteSchema.index({ userId: 1, createdAt: -1 });
quoteSchema.index({ email: 1, createdAt: -1 });
quoteSchema.index({ paymentIntentId: 1 }, { unique: true, sparse: true });

export const Quote = model<IQuote>("Quote", quoteSchema);
