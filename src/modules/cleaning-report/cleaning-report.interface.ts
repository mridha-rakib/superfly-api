import type { Document, Types } from "mongoose";

export type CleaningReportStatus = "pending" | "approved";

export interface ICleaningReport extends Document {
  _id: Types.ObjectId;
  quoteId: Types.ObjectId | string;
  cleanerId: Types.ObjectId | string;
  beforePhotos: string[];
  afterPhotos: string[];
  arrivalTime: Date;
  startTime: Date;
  endTime: Date;
  notes?: string;
  status: CleaningReportStatus;
  createdAt: Date;
  updatedAt: Date;
}
