import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import {
  confirmQuotePaymentSchema,
  createQuoteAuthSchema,
  createQuoteGuestSchema,
} from "./quote.schema";
import { QuoteService } from "./quote.service";

export class QuoteController {
  private quoteService: QuoteService;

  constructor() {
    this.quoteService = new QuoteService();
  }

  createPaymentIntent = asyncHandler(async (req: Request, res: Response) => {
    const isAuthenticated = Boolean(req.user);
    const schema = isAuthenticated
      ? createQuoteAuthSchema
      : createQuoteGuestSchema;
    const validated = await zParse(schema, req);

    const intent = await this.quoteService.createPaymentIntent(
      validated.body,
      req.user?.userId
    );

    ApiResponse.success(res, intent, "Payment intent created successfully");
  });

  confirmPayment = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(confirmQuotePaymentSchema, req);
    const quote = await this.quoteService.confirmPayment(
      validated.body.paymentIntentId,
      req.user?.userId
    );

    ApiResponse.created(res, quote, "Quote created successfully");
  });
}
