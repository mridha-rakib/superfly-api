import { z } from "zod";

const serviceSelectionSchema = z.record(
  z.string().min(1),
  z.coerce.number().int().min(0).default(0),
);

const recurringSchema = z.object({
  interval: z.enum(["day", "week", "month", "year"]),
  intervalCount: z.coerce.number().int().min(1).max(52).optional(),
});

export const createCheckoutSessionSchema = z.object({
  body: z
    .object({
      services: serviceSelectionSchema.default({}),
      mode: z.enum(["payment"]).optional(),
      recurring: recurringSchema.optional(),
    })
    .refine((data) => data.recurring && data.recurring.interval, {
      message: "Recurring interval is required for subscriptions",
      path: ["recurring"],
    }),
});
