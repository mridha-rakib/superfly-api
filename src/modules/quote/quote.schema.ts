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

export const confirmQuotePaymentSchema = z.object({
  body: z.object({
    paymentIntentId: z.string().min(1),
  }),
});
