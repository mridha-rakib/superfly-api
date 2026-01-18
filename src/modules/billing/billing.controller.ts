import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import { createCheckoutSessionSchema } from "./billing.schema";
import { BillingService } from "./billing.service";

export class BillingController {
  private billingService: BillingService;

  constructor() {
    this.billingService = new BillingService();
  }

  createCheckoutSession = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(createCheckoutSessionSchema, req);
    const session = await this.billingService.createCheckoutSession(
      validated.body,
      req.user?.userId,
    );

    ApiResponse.success(res, session, "Checkout session created successfully");
  });

  handleWebhook = asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    const stripeSignature = Array.isArray(signature) ? signature[0] : signature;

    await this.billingService.handleWebhook(
      req.body as Buffer,
      stripeSignature,
    );

    res.json({ received: true });
  });
}
