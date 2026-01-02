import { QUOTE } from "@/constants/app.constants";
import { z } from "zod";

const serviceSelectionSchema = z.record(
  z.string().min(1),
  z.coerce.number().int().min(0).default(0)
);

const baseQuoteSchema = z.object({
  notes: z.string().max(500).optional(),
  services: serviceSelectionSchema.default({}),
  serviceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Service date must be YYYY-MM-DD"),
});

const baseServiceRequestSchema = z.object({
  companyName: z.string().trim().min(1).max(150),
  businessAddress: z.string().trim().min(3).max(250),
  preferredDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Preferred date must be YYYY-MM-DD"),
  preferredTime: z.string().trim().min(1).max(60),
  specialRequest: z.string().trim().min(1).max(500),
});

export const createQuoteGuestSchema = z.object({
  body: baseQuoteSchema.extend({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email("Invalid email format"),
    phoneNumber: z.string().min(6).max(20),
  }),
});

export const createQuoteAuthSchema = z.object({
  body: baseQuoteSchema.extend({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email("Invalid email format").optional(),
    phoneNumber: z.string().min(6).max(20).optional(),
  }),
});

export const createServiceRequestGuestSchema = z.object({
  body: baseServiceRequestSchema.extend({
    name: z.string().trim().min(1).max(200),
    email: z.string().email("Invalid email format"),
    phoneNumber: z.string().trim().min(6).max(20),
  }),
});

export const createServiceRequestAuthSchema = z.object({
  body: baseServiceRequestSchema.extend({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.string().email("Invalid email format").optional(),
    phoneNumber: z.string().trim().min(6).max(20).optional(),
  }),
});

export const updateQuoteStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      QUOTE.STATUSES.ADMIN_NOTIFIED,
      QUOTE.STATUSES.REVIEWED,
      QUOTE.STATUSES.CONTACTED,
    ]),
  }),
  params: z.object({
    quoteId: z.string().min(1),
  }),
});

export const confirmQuotePaymentSchema = z.object({
  body: z.object({
    paymentIntentId: z.string().min(1),
  }),
});
