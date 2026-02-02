import { z } from "zod";

export const createReviewSchema = z.object({
  body: z.object({
    quoteId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).optional(),
    clientName: z.string().trim().max(150).optional(),
  }),
});
