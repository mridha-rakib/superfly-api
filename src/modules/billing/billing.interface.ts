import type { Document, Types } from "mongoose";
import type {
  BillingLineItem,
  BillingMode,
  BillingStatus,
} from "./billing.type";

export interface IBillingPayment extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId | string;
  internalOrderId: string;
  mode: BillingMode;
  status: BillingStatus;
  amount: number;
  currency: string;
  items: BillingLineItem[];
  stripeSessionId: string;
  stripeCustomerId?: string;
  paymentIntentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStripeEvent extends Document {
  _id: Types.ObjectId;
  eventId: string;
  type: string;
  livemode: boolean;
  createdAtStripe: Date;
  createdAt: Date;
  updatedAt: Date;
}
