import { z } from "zod";

export const sendPublicContactMessageSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email("Invalid email format"),
    subject: z.string().trim().min(3).max(160),
    message: z.string().trim().min(10).max(2000),
  }),
});

