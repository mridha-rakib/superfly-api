// file: src/utils/validators.utils.ts
import type { Request } from "express";
import type z from "zod";
import { ZodError, type ZodTypeAny } from "zod";

export async function zParse<T extends ZodTypeAny>(
  schema: T,
  req: Request
): Promise<z.infer<T>> {
  try {
    const result = await schema.parseAsync({
      body: req.body,
      query: req.query as any,
      params: req.params as any,
      cookies: req.cookies,
      headers: req.headers,
    });

    return result;
  } catch (error) {
    if (error instanceof ZodError) {
      throw error;
    }
    throw new Error("Validation failed");
  }
}
