import { z } from "zod";

export const createCleaningServiceSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    price: z.coerce.number().positive("Price must be greater than zero"),
  }),
});

export const updateCleaningServiceSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).optional(),
    category: z.string().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateCleaningServicePriceSchema = z.object({
  body: z.object({
    price: z.coerce.number().positive("Price must be greater than zero"),
  }),
});
