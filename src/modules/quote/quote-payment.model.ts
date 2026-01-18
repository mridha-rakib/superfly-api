import { QUOTE } from "@/constants/app.constants";
import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { IQuotePaymentDraft } from "./quote.interface";

const quotePaymentDraftSchema = BaseSchemaUtil.createSchema<IQuotePaymentDraft>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
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
    serviceDate: {
      type: String,
      required: true,
      index: true,
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
      required: true,
      default: QUOTE.CURRENCY,
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentIntentId: {
      type: String,
    },
    stripeSessionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    paymentAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentStatus: {
      type: String,
      required: true,
      default: "pending",
    },
    quoteId: {
      type: Schema.Types.ObjectId,
      ref: "Quote",
    },
  },
);

quotePaymentDraftSchema.index(
  { paymentIntentId: 1 },
  { unique: true, sparse: true },
);

export const QuotePaymentDraft = model<IQuotePaymentDraft>(
  "QuotePaymentDraft",
  quotePaymentDraftSchema,
);
