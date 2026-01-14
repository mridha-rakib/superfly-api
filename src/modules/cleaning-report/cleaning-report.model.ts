import { QUOTE } from "@/constants/app.constants";
import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { ICleaningReport } from "./cleaning-report.interface";

const cleaningReportSchema = BaseSchemaUtil.createSchema<ICleaningReport>({
  quoteId: {
    type: Schema.Types.ObjectId,
    ref: "Quote",
    required: true,
    index: true,
  },
  cleanerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  beforePhotos: [
    {
      type: String,
      required: true,
    },
  ],
  afterPhotos: [
    {
      type: String,
      required: true,
    },
  ],
  arrivalTime: {
    type: Date,
    required: true,
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  notes: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: Object.values(QUOTE.REPORT_STATUSES),
    default: QUOTE.REPORT_STATUSES.PENDING,
    index: true,
  },
});

cleaningReportSchema.index({ quoteId: 1 }, { unique: true });

export const CleaningReport = model<ICleaningReport>(
  "CleaningReport",
  cleaningReportSchema
);
