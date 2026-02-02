import type { Document, Types } from "mongoose";

export interface IReview extends Document {
  quoteId: Types.ObjectId | string;
  clientId: Types.ObjectId | string;
  rating: number;
  comment?: string;
  clientName?: string;
  createdAt: Date;
  updatedAt: Date;
}
