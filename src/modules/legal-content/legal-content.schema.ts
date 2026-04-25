import { z } from "zod";
import { LEGAL_CONTENT_SLUGS } from "./legal-content.type";

const slugSchema = z.enum(LEGAL_CONTENT_SLUGS);

export const getLegalContentSchema = z.object({
  params: z.object({
    slug: slugSchema,
  }),
});

export const upsertLegalContentSchema = z.object({
  params: z.object({
    slug: slugSchema,
  }),
  body: z.object({
    title: z.string().trim().min(3).max(180),
    content: z.string().trim().min(20).max(50000),
  }),
});
