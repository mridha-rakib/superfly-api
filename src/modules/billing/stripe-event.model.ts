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
  createdAtStripe: {
    type: Date,
    required: true,
  },
});

export const StripeEvent = model<IStripeEvent>(
  "StripeEvent",
  stripeEventSchema,
);
