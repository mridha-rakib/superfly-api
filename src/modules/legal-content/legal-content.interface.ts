import type { Document, Types } from "mongoose";
import type { LegalContentSlug } from "./legal-content.type";

export interface ILegalContent extends Document {
  slug: LegalContentSlug;
  title: string;
  content: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
