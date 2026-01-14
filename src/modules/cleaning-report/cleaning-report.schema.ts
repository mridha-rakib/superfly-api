import { z } from "zod";

export const createCleaningReportSchema = z.object({
  body: z.object({
    beforePhotos: z.array(z.string().min(1)).min(1).optional(),
    afterPhotos: z.array(z.string().min(1)).min(1).optional(),
    arrivalTime: z.string().datetime(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    notes: z.string().max(1000).optional(),
  }),
  params: z.object({
    quoteId: z.string().min(1),
  }),
});

export const reportDetailSchema = z.object({
  params: z.object({
    reportId: z.string().min(1),
  }),
});
