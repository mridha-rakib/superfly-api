import type { QuoteResponse } from "@/modules/quote/quote.type";
import type { CleaningReportStatus } from "./cleaning-report.interface";

export type CleaningReportCreatePayload = {
  beforePhotos?: string[];
  afterPhotos?: string[];
  arrivalTime: string;
  startTime: string;
  endTime: string;
  notes?: string;
};

export type CleaningReportResponse = {
  _id: string;
  quoteId: string;
  cleanerId: string;
  beforePhotos: string[];
  afterPhotos: string[];
  arrivalTime: Date;
  startTime: Date;
  endTime: Date;
  notes?: string;
  status: CleaningReportStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CleanerSummary = {
  _id: string;
  fullName: string;
  email: string;
  phoneNumber?: string;
  profileImageUrl?: string;
};

export type CleaningReportAdminResponse = CleaningReportResponse & {
  quote?: QuoteResponse;
  cleaner?: CleanerSummary;
};
