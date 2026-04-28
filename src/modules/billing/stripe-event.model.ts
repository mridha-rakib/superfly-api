import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { model } from "mongoose";
import type { IStripeEvent } from "./billing.interface";

const stripeEventSchema = BaseSchemaUtil.createSchema<IStripeEvent>({
  eventId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
  },
  livemode: {
    type: Boolean,
    required: true,
  },
  status: {
    type: String,
    enum: ["processing", "processed", "failed"],
    required: true,
    default: "processing",
    index: true,
  },
  lastError: {
    type: String,
    trim: true,
  },
  createdAtStripe: {
    type: Date,
    required: true,
  },
});

export const StripeEvent = model<IStripeEvent>(
  "StripeEvent",
  stripeEventSchema,
);
