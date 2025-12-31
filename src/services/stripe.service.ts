// file: src/services/stripe.service.ts

import { env } from "@/env";
import Stripe from "stripe";

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-04-10",
    });
  }

  async createPaymentIntent(params: Stripe.PaymentIntentCreateParams) {
    return this.stripe.paymentIntents.create(params);
  }

  async retrievePaymentIntent(paymentIntentId: string) {
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }
}

export const stripeService = new StripeService();
