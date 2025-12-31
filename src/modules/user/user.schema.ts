// file: src/modules/user/user.schema.ts

import { z } from "zod";

export const updateUserSchema = z.object({
  body: z.object({
    fullName: z.string().min(2).max(100).optional(),
    phoneNumber: z.string().optional(),
    address: z.string().min(2).max(250).optional(),
  }),
});
