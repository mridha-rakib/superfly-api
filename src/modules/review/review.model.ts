import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { IReview } from "./review.interface";

const reviewSchema = BaseSchemaUtil.createSchema<IReview>({
  quoteId: {
    type: Schema.Types.ObjectId,
    ref: "Quote",
    required: true,
    index: true,
  },
  clientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
  },
  comment: {
    type: String,
    trim: true,
  },
  clientName: {
    type: String,
    trim: true,
  },
});

reviewSchema.index({ quoteId: 1 }, { unique: true });

export const Review = model<IReview>("Review", reviewSchema);
