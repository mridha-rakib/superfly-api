import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { ICleaningServicePriceHistory } from "./cleaning-service.interface";

const priceHistorySchema =
  BaseSchemaUtil.createSchema<ICleaningServicePriceHistory>({
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: "CleaningService",
      required: true,
      index: true,
    },
    serviceName: {
      type: String,
      required: true,
    },
    oldPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    newPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    changedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  });

priceHistorySchema.index({ serviceId: 1, changedAt: -1 });

export const CleaningServicePriceHistory =
  model<ICleaningServicePriceHistory>(
    "CleaningServicePriceHistory",
    priceHistorySchema
  );
