import { z } from "zod";

const inputTypeCreateSchema = z.enum(["BOOLEAN", "QUANTITY"]).default("BOOLEAN");
const inputTypeUpdateSchema = z.enum(["BOOLEAN", "QUANTITY"]);

export const createCleaningServiceSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    price: z.coerce.number().positive("Price must be greater than zero"),
    inputType: inputTypeCreateSchema,
    quantityLabel: z.string().min(1).max(120).optional(),
  }),
});

export const updateCleaningServiceSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(500).optional(),
    category: z.string().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
    inputType: inputTypeUpdateSchema.optional(),
    quantityLabel: z.string().min(1).max(120).optional(),
  }),
});

export const updateCleaningServicePriceSchema = z.object({
  body: z.object({
    price: z.coerce.number().positive("Price must be greater than zero"),
  }),
});
