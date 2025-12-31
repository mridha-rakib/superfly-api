import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { model } from "mongoose";
import type { ICleaningService } from "./cleaning-service.interface";

const cleaningServiceSchema = BaseSchemaUtil.createSchema<ICleaningService>({
  ...BaseSchemaUtil.softDeleteFields(),
  name: {
    type: String,
    required: true,
    trim: true,
  },
  nameLower: {
    type: String,
    required: true,
    index: true,
  },
  code: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  category: {
    type: String,
    required: true,
    default: "general",
    index: true,
  },
  description: {
    type: String,
    trim: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
});

cleaningServiceSchema.index({ nameLower: 1, category: 1 }, { unique: true });

export const CleaningService = model<ICleaningService>(
  "CleaningService",
  cleaningServiceSchema
);
