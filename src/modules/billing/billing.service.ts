import { env } from "@/env";
import { logger } from "@/middlewares/pino-logger";
import { stripeService } from "@/services/stripe.service";
import {
  BadRequestException,
  NotFoundException,
} from "@/utils/app-error.utils";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { CleaningServiceService } from "../cleaning-service/cleaning-service.service";
import { QuotePaymentDraftRepository } from "../quote/quote-payment.repository";
import { QuotePricingService } from "../quote/quote.pricing";
import { UserService } from "../user/user.service";
import { stripeCheckoutUrls } from "./billing.config";
import { BillingPaymentRepository } from "./billing.repository";
import type {
  BillingMode,
  BillingStatus,
  CheckoutSessionPayload,
  CheckoutSessionResponse,
  ServiceSelection,
} from "./billing.type";
import { StripeEventRepository } from "./stripe-event.repository";

export class BillingService {
  private paymentRepository: BillingPaymentRepository;
  private eventRepository: StripeEventRepository;
  private quotePaymentDraftRepository: QuotePaymentDraftRepository;
  private cleaningServiceService: CleaningServiceService;
  private pricingService: QuotePricingService;
  private userService: UserService;

  constructor() {
    this.paymentRepository = new BillingPaymentRepository();
    this.eventRepository = new StripeEventRepository();
    this.quotePaymentDraftRepository = new QuotePaymentDraftRepository();
    this.cleaningServiceService = new CleaningServiceService();
    this.pricingService = new QuotePricingService();
    this.userService = new UserService();
  }

  async createCheckoutSession(
    payload: CheckoutSessionPayload,
    userId?: string,
  ): Promise<CheckoutSessionResponse> {
    if (!userId) {
      throw new BadRequestException("User is required");
    }

    const user = await this.userService.getById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const selections = this.normalizeServiceSelections(payload.services);
    const requestedCodes = Object.keys(selections);
    if (requestedCodes.length === 0) {
      throw new BadRequestException("At least one service is required");
    }

    const activeServices =
      await this.cleaningServiceService.getActiveServicesByCodes(
        requestedCodes,
      );
    if (activeServices.length === 0) {
      throw new BadRequestException(
        "No active services configured for requested codes",
      );
    }

    this.ensureAllServicesFound(selections, activeServices);

    const pricing = this.pricingService.calculate(selections, activeServices);
    const items = pricing.items.filter((item) => item.quantity > 0);
    if (items.length === 0) {
      throw new BadRequestException("No billable services selected");
    }

    if (pricing.currency.toUpperCase() !== "USD") {
      throw new BadRequestException(
        "Only USD is supported for Stripe payments",
      );
    }

    const mode: BillingMode = payload.mode || "payment";

    const currency = pricing.currency.toLowerCase();
    const totalAmount = items.reduce(
      (sum, item) => sum + this.toMinorAmount(item.unitPrice) * item.quantity,
      0,
    );
    if (totalAmount <= 0) {
      throw new BadRequestException("Total amount must be greater than zero");
    }

    const internalOrderId = randomUUID();
    const metadata = {
      userId: user._id.toString(),
      internalOrderId,
      serviceCodes: items.map((item) => item.key).join(","),
    };

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode,
      success_url: stripeCheckoutUrls.successUrl,
      cancel_url: stripeCheckoutUrls.cancelUrl,
      payment_method_types: ["card"],
      line_items: items.map((item) => {
        const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData =
          {
            currency,
            unit_amount: this.toMinorAmount(item.unitPrice),
            product_data: {
              name: item.label,
            },
          };

        return {
          price_data: priceData,
          quantity: item.quantity,
        };
      }),
      customer_email: user.email,
      client_reference_id: internalOrderId,
      metadata,
    };

    if (mode === "payment") {
      sessionParams.payment_intent_data = { metadata };
    }

    const session = await stripeService.createCheckoutSession(sessionParams);
    if (!session.url) {
      throw new BadRequestException("Checkout session URL is missing");
    }

    await this.paymentRepository.create({
      userId: user._id,
      internalOrderId,
      mode,
      status: "pending",
      amount: totalAmount,
      currency,
      items,
      stripeSessionId: session.id,
      stripeCustomerId: this.resolveStripeId(session.customer),
      paymentIntentId: this.resolveStripeId(session.payment_intent),
    });

    return {
      url: session.url,
      sessionId: session.id,
      internalOrderId,
    };
  }

  async handleWebhook(payload: Buffer, signature?: string): Promise<void> {
    if (!signature) {
      throw new BadRequestException("Missing stripe-signature header");
    }

    const event = stripeService.constructWebhookEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );

    const stored = await this.eventRepository.createOnce({
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      createdAtStripe: new Date(event.created * 1000),
    });

    if (!stored) {
      return;
    }

    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "checkout.session.async_payment_succeeded":
        await this.updateFromSession(
          event.data.object as Stripe.Checkout.Session,
          "paid",
        );
        break;
      case "checkout.session.async_payment_failed":
        await this.updateFromSession(
          event.data.object as Stripe.Checkout.Session,
          "failed",
        );
        break;
      case "checkout.session.expired":
        await this.updateFromSession(
          event.data.object as Stripe.Checkout.Session,
          "canceled",
        );
        break;
      case "payment_intent.succeeded":
        await this.updateFromPaymentIntent(
          event.data.object as Stripe.PaymentIntent,
          "paid",
        );
        break;
      case "payment_intent.created":
        logger.debug({ eventType: event.type }, "Stripe payment intent created");
        break;
      case "payment_intent.payment_failed":
        await this.updateFromPaymentIntent(
          event.data.object as Stripe.PaymentIntent,
          "failed",
        );
        break;
      case "invoice.payment_succeeded":
        await this.updateFromInvoice(
          event.data.object as Stripe.Invoice,
          "paid",
        );
        break;
      case "invoice.payment_failed":
        await this.updateFromInvoice(
          event.data.object as Stripe.Invoice,
          "failed",
        );
        break;
      case "charge.succeeded":
      case "charge.updated":
        logger.debug({ eventType: event.type }, "Stripe charge event ignored");
        break;
      default:
        logger.info({ eventType: event.type }, "Unhandled Stripe event");
    }
  }

  private async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const status = this.resolvePaymentStatus(session);
    await this.updateFromSession(session, status);
  }

  private resolvePaymentStatus(
    session: Stripe.Checkout.Session,
  ): BillingStatus {
    if (session.payment_status === "paid") {
      return "paid";
    }
    if (session.payment_status === "no_payment_required") {
      return "paid";
    }
    return "pending";
  }

  private async updateFromSession(
    session: Stripe.Checkout.Session,
    status: BillingStatus,
  ): Promise<void> {
    const update = this.buildUpdateFromSession(session, status);
    const updated = await this.paymentRepository.updateBySessionId(
      session.id,
      update,
    );

    if (!updated) {
      const draftUpdated = await this.updateQuoteDraftFromSession(
        session,
        status,
      );
      if (!draftUpdated) {
        logger.warn(
          { stripeSessionId: session.id },
          "Stripe session not tracked",
        );
      }
    }
  }

  private async updateFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
    status: BillingStatus,
  ): Promise<void> {
    const update: Partial<Record<string, any>> = {
      status,
      stripeCustomerId: this.resolveStripeId(paymentIntent.customer),
      paymentIntentId: paymentIntent.id,
    };

    if (
      paymentIntent.amount_received !== null &&
      paymentIntent.amount_received !== undefined
    ) {
      update.amount = paymentIntent.amount_received;
    }

    if (paymentIntent.currency) {
      update.currency = paymentIntent.currency;
    }

    const updated = await this.paymentRepository.updateByPaymentIntentId(
      paymentIntent.id,
      update,
    );

    if (!updated) {
      let draftUpdated = await this.updateQuoteDraftFromPaymentIntent(
        paymentIntent,
        status,
      );
      if (!draftUpdated) {
        const session =
          await this.findCheckoutSessionForPaymentIntent(paymentIntent.id);
        if (session) {
          draftUpdated = await this.updateQuoteDraftFromSession(
            session,
            status,
          );
        }
      }
      if (!draftUpdated) {
        logger.warn(
          { paymentIntentId: paymentIntent.id },
          "Payment intent not tracked",
        );
      }
    }
  }

  private async updateFromInvoice(
    invoice: Stripe.Invoice,
    status: BillingStatus,
  ): Promise<void> {
    const update: Partial<Record<string, any>> = {
      status,
      stripeCustomerId: this.resolveStripeId(invoice.customer),
    };

    if (invoice.amount_paid !== null && invoice.amount_paid !== undefined) {
      update.amount = invoice.amount_paid;
    }

    if (invoice.currency) {
      update.currency = invoice.currency;
    }
  }

  private buildUpdateFromSession(
    session: Stripe.Checkout.Session,
    status: BillingStatus,
  ) {
    const update: Record<string, any> = {
      status,
      stripeCustomerId: this.resolveStripeId(session.customer),
      paymentIntentId: this.resolveStripeId(session.payment_intent),
    };

    if (session.amount_total !== null && session.amount_total !== undefined) {
      update.amount = session.amount_total;
    }

    if (session.currency) {
      update.currency = session.currency;
    }

    return update;
  }

  private async updateQuoteDraftFromSession(
    session: Stripe.Checkout.Session,
    status: BillingStatus,
  ): Promise<boolean> {
    const update: Record<string, any> = {};
    const paymentIntentId = this.resolveStripeId(session.payment_intent);

    if (paymentIntentId) {
      update.paymentIntentId = paymentIntentId;
    }

    if (status === "paid") {
      update.paymentStatus = "completed";
    }

    if (Object.keys(update).length > 0) {
      const updated =
        await this.quotePaymentDraftRepository.updateByStripeSessionId(
          session.id,
          update,
        );
      return Boolean(updated);
    }

    const existing =
      await this.quotePaymentDraftRepository.findByStripeSessionId(session.id);
    return Boolean(existing);
  }

  private async updateQuoteDraftFromPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
    status: BillingStatus,
  ): Promise<boolean> {
    const update: Record<string, any> = {};

    if (status === "paid") {
      update.paymentStatus = "completed";
    }

    if (Object.keys(update).length > 0) {
      const updated =
        await this.quotePaymentDraftRepository.updateByPaymentIntentId(
          paymentIntent.id,
          update,
        );
      return Boolean(updated);
    }

    const existing =
      await this.quotePaymentDraftRepository.findByPaymentIntentId(
        paymentIntent.id,
      );
    return Boolean(existing);
  }

  private async findCheckoutSessionForPaymentIntent(
    paymentIntentId: string,
  ): Promise<Stripe.Checkout.Session | null> {
    try {
      const sessions = await stripeService.listCheckoutSessionsByPaymentIntent(
        paymentIntentId,
        1,
      );
      return sessions.data[0] || null;
    } catch (error) {
      logger.debug(
        { paymentIntentId, error },
        "Failed to lookup checkout session for payment intent",
      );
      return null;
    }
  }

  private normalizeServiceSelections(
    selections: ServiceSelection,
  ): ServiceSelection {
    const normalized: ServiceSelection = {};
    Object.entries(selections || {}).forEach(([key, value]) => {
      const normalizedKey = this.normalizeServiceKey(key);
      normalized[normalizedKey] = value ?? 0;
    });
    return normalized;
  }

  private normalizeServiceKey(key: string): string {
    const normalized = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    return normalized || key.trim().toLowerCase();
  }

  private ensureAllServicesFound(
    selections: ServiceSelection,
    services: { code: string }[],
  ): void {
    const availableCodes = new Set(services.map((service) => service.code));
    const unknown = Object.keys(selections).filter(
      (code) => !availableCodes.has(code),
    );

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown service codes: ${unknown.join(", ")}`,
      );
    }
  }

  private toMinorAmount(amount: number): number {
    return Math.round(amount * 100);
  }

  private resolveStripeId(
    value?: string | { id: string } | null,
  ): string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "object" && "id" in value) {
      return value.id;
    }
    return undefined;
  }
}
