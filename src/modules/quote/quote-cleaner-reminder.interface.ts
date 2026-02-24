import type { Document, Types } from "mongoose";

export type QuoteCleanerReminderType = "cleaner_24h_before";

export type QuoteCleanerReminderLookup = {
  quoteId: Types.ObjectId | string;
  cleanerId: Types.ObjectId | string;
  occurrenceStartAt: Date;
  reminderType: QuoteCleanerReminderType;
};

export type QuoteCleanerReminderCreatePayload = QuoteCleanerReminderLookup & {
  sentAt: Date;
};

export interface IQuoteCleanerReminder extends Document {
  _id: Types.ObjectId;
  quoteId: Types.ObjectId | string;
  cleanerId: Types.ObjectId | string;
  occurrenceStartAt: Date;
  reminderType: QuoteCleanerReminderType;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
