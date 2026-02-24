import { BaseSchemaUtil } from "@/utils/base-schema.utils";
import { Schema, model } from "mongoose";
import type { IQuoteCleanerReminder } from "./quote-cleaner-reminder.interface";

const quoteCleanerReminderSchema =
  BaseSchemaUtil.createSchema<IQuoteCleanerReminder>({
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
    occurrenceStartAt: {
      type: Date,
      required: true,
      index: true,
    },
    reminderType: {
      type: String,
      required: true,
      default: "cleaner_24h_before",
    },
    sentAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  });

quoteCleanerReminderSchema.index(
  {
    quoteId: 1,
    cleanerId: 1,
    occurrenceStartAt: 1,
    reminderType: 1,
  },
  { unique: true },
);

export const QuoteCleanerReminder = model<IQuoteCleanerReminder>(
  "QuoteCleanerReminder",
  quoteCleanerReminderSchema,
);
