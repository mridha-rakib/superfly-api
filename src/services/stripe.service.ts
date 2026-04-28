// file: src/services/stripe.service.ts

import { env } from "@/env";
import { ErrorCodeEnum } from "@/enums/error-code.enum";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@/utils/app-error.utils";
import Stripe from "stripe";

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-12-15.clover",
      maxNetworkRetries: 2,
    });
  }

  async createPaymentIntent(params: Stripe.PaymentIntentCreateParams) {
    return this.withStripeErrors(() => this.stripe.paymentIntents.create(params));
  }

  async createCheckoutSession(params: Stripe.Checkout.SessionCreateParams) {
    return this.withStripeErrors(() =>
      this.stripe.checkout.sessions.create(params),
    );
  }

  async retrievePaymentIntent(paymentIntentId: string) {
    return this.withStripeErrors(() =>
      this.stripe.paymentIntents.retrieve(paymentIntentId),
    );
  }

  async retrieveCheckoutSession(
    sessionId: string,
    params?: Stripe.Checkout.SessionRetrieveParams,
  ) {
    return this.withStripeErrors(() =>
      this.stripe.checkout.sessions.retrieve(sessionId, params),
    );
  }

  async listCheckoutSessionsByPaymentIntent(
    paymentIntentId: string,
    limit: number = 1,
  ) {
    return this.withStripeErrors(() =>
      this.stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit,
      }),
    );
  }

  async confirmPaymentIntent(
    paymentIntentId: string,
    paymentMethodId?: string,
  ) {
    const params = paymentMethodId
      ? { payment_method: paymentMethodId }
      : undefined;
    return this.withStripeErrors(() =>
      this.stripe.paymentIntents.confirm(paymentIntentId, params),
    );
  }

  async cancelPaymentIntent(paymentIntentId: string) {
    return this.withStripeErrors(() =>
      this.stripe.paymentIntents.cancel(paymentIntentId),
    );
  }

  async expireCheckoutSession(sessionId: string) {
    return this.withStripeErrors(() =>
      this.stripe.checkout.sessions.expire(sessionId),
    );
  }

  constructWebhookEvent(
    payload: Buffer,
    signature: string,
    webhookSecret: string,
  ) {
    return this.withStripeErrors(() =>
      this.stripe.webhooks.constructEvent(payload, signature, webhookSecret),
    );
  }

  private async withStripeErrors<T>(operation: () => Promise<T>): Promise<T>;
  private withStripeErrors<T>(operation: () => T): T;
  private withStripeErrors<T>(operation: () => T | Promise<T>): T | Promise<T> {
    try {
      const result = operation();
      if (result instanceof Promise) {
        return result.catch((error) => {
          throw this.toPaymentError(error);
        });
      }
      return result;
    } catch (error) {
      throw this.toPaymentError(error);
    }
  }

  private toPaymentError(error: unknown) {
    if (error instanceof BadRequestException) {
      return error;
    }

    const stripeError = error as Stripe.errors.StripeError & {
      raw?: { message?: string };
    };

    if (!stripeError?.type) {
      return error;
    }

    const message =
      stripeError.raw?.message ||
      stripeError.message ||
      "Payment provider request failed";

    switch (stripeError.type) {
      case "StripeCardError":
        return new BadRequestException(message, ErrorCodeEnum.PAYMENT_DECLINED);
      case "StripeInvalidRequestError":
      case "StripeSignatureVerificationError":
        return new BadRequestException(message, ErrorCodeEnum.PAYMENT_ERROR);
      case "StripeRateLimitError":
        return new ServiceUnavailableException(
          "Payment provider is rate limiting requests. Please try again shortly.",
          ErrorCodeEnum.PAYMENT_RATE_LIMITED,
        );
      case "StripeAPIError":
      case "StripeConnectionError":
      case "StripeAuthenticationError":
      case "StripePermissionError":
        return new ServiceUnavailableException(
          "Payment provider is temporarily unavailable. Please try again shortly.",
          ErrorCodeEnum.PAYMENT_PROVIDER_UNAVAILABLE,
        );
      default:
        return new ServiceUnavailableException(
          "Payment provider request failed. Please try again shortly.",
          ErrorCodeEnum.PAYMENT_PROVIDER_UNAVAILABLE,
        );
    }
  }
}

export const stripeService = new StripeService();
