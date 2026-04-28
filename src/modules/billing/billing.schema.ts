import { z } from "zod";

const serviceSelectionSchema = z.record(
  z.string().min(1),
  z.coerce.number().int().min(0).default(0),
);

export const createCheckoutSessionSchema = z.object({
  body: z.object({
    services: serviceSelectionSchema.default({}),
    mode: z.literal("payment").optional(),
  }),
});
