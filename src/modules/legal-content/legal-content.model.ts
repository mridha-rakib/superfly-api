import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { model, Schema } from "mongoose";
import type { ILegalContent } from "./legal-content.interface";
import { LEGAL_CONTENT_SLUGS } from "./legal-content.type";

const legalContentSchema = BaseSchemaUtil.createSchema<ILegalContent>({
  slug: {
    type: String,
    enum: LEGAL_CONTENT_SLUGS,
    required: true,
    unique: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  updatedBy: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
});

export const LegalContent = model<ILegalContent>(
  "LegalContent",
  legalContentSchema
);
