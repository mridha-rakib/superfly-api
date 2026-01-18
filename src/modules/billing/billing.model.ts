import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { IBillingPayment } from "./billing.interface";

const billingPaymentSchema = BaseSchemaUtil.createSchema<IBillingPayment>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  internalOrderId: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  mode: {
    type: String,
    enum: ["payment"],
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "paid", "failed", "canceled"],
    default: "pending",
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  items: [
    {
      key: { type: String, required: true },
      label: { type: String, required: true },
      unitPrice: { type: Number, required: true, min: 0 },
      quantity: { type: Number, required: true, min: 1 },
      subtotal: { type: Number, required: true, min: 0 },
    },
  ],
  stripeSessionId: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  stripeCustomerId: {
    type: String,
    index: true,
  },
  paymentIntentId: {
    type: String,
    index: true,
    sparse: true,
  },
});

export const BillingPayment = model<IBillingPayment>(
  "BillingPayment",
  billingPaymentSchema,
);
