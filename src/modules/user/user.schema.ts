import { z } from "zod";

export const createCleanerSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(1).max(200),
    email: z.string().email(),
    cleanerPercentage: z.coerce.number().min(0).max(100),
    phoneNumber: z.string().trim().min(3).max(20).optional(),
    address: z.string().trim().min(1).max(250).optional(),
  }),
});
