import { QUOTE, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { stripeService } from "@/services/stripe.service";
import type { PaginateResult } from "@/ts/pagination.types";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@/utils/app-error.utils";
import type { PaginateOptions } from "mongoose";
import type Stripe from "stripe";
import { stripeCheckoutUrls } from "../billing/billing.config";
import { CleaningServiceService } from "../cleaning-service/cleaning-service.service";
import { UserService } from "../user/user.service";
import { QuoteNotificationRepository } from "./quote-notification.repository";
import { QuotePaymentDraftRepository } from "./quote-payment.repository";
import type { IQuote } from "./quote.interface";
import { QuotePricingService } from "./quote.pricing";
import { QuoteRepository } from "./quote.repository";
import type {
  QuoteAssignCleanerPayload,
  QuoteCreatePayload,
  QuotePaymentIntentResponse,
  QuotePaymentStatusResponse,
  QuoteRequestPayload,
  QuoteResponse,
  QuoteStatusUpdatePayload,
} from "./quote.type";

type QuoteContact = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
};

type QuoteRequestContact = {
  contactName?: string;
  email?: string;
  phoneNumber?: string;
};

export class QuoteService {
  private quoteRepository: QuoteRepository;
  private paymentDraftRepository: QuotePaymentDraftRepository;
  private notificationRepository: QuoteNotificationRepository;
  private pricingService: QuotePricingService;
  private cleaningServiceService: CleaningServiceService;
  private userService: UserService;

  constructor() {
    this.quoteRepository = new QuoteRepository();
    this.paymentDraftRepository = new QuotePaymentDraftRepository();
    this.notificationRepository = new QuoteNotificationRepository();
    this.pricingService = new QuotePricingService();
    this.cleaningServiceService = new CleaningServiceService();
    this.userService = new UserService();
  }

  async createPaymentIntent(
    payload: QuoteCreatePayload,
    requestUserId?: string,
  ): Promise<QuotePaymentIntentResponse> {
    const { contact, userId } = await this.resolveContact(
      payload,
      requestUserId,
    );
    const pricingInput = this.normalizeServiceSelections(payload.services);
    const requestedCodes = Object.keys(pricingInput);
    const activeServices = requestedCodes.length
      ? await this.cleaningServiceService.getActiveServicesByCodes(
          requestedCodes,
        )
      : [];

    if (requestedCodes.length > 0) {
      if (activeServices.length === 0) {
        throw new BadRequestException(
          "No active services configured for requested codes",
        );
      }

      this.ensureAllServicesFound(pricingInput, activeServices);
    }

    const pricing = this.pricingService.calculate(pricingInput, activeServices);
    const amount = this.toMinorAmount(pricing.total);
    const serviceDate = payload.serviceDate.trim();
    const paymentFlow = payload.paymentFlow || "checkout";
    const normalizedCurrency = pricing.currency.toUpperCase();

    if (normalizedCurrency !== "USD") {
      throw new BadRequestException(
        "Only USD is supported for Stripe payments",
      );
    }

    if (amount <= 0) {
      throw new BadRequestException("Total amount must be greater than zero");
    }

    if (paymentFlow === "intent") {
      const paymentIntent = await stripeService.createPaymentIntent({
        amount,
        currency: pricing.currency.toLowerCase(),
        receipt_email: contact.email,
        payment_method_types: ["card"],
        metadata: {
          userId: userId || "",
          serviceDate,
        },
      });

      if (!paymentIntent.client_secret) {
        throw new BadRequestException(
          "Payment intent could not be initialized",
        );
      }

      await this.paymentDraftRepository.create({
        userId,
        firstName: contact.firstName!,
        lastName: contact.lastName!,
        email: contact.email!,
        phoneNumber: contact.phoneNumber!,
        serviceDate,
        notes: payload.notes?.trim(),
        services: pricing.items,
        totalPrice: pricing.total,
        currency: pricing.currency,
        paymentIntentId: paymentIntent.id,
        paymentAmount: amount,
        paymentStatus: "pending",
      });

      return {
        flow: "intent",
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount,
        currency: pricing.currency,
      };
    }

    const items = pricing.items.filter((item) => item.quantity > 0);
    if (items.length === 0) {
      throw new BadRequestException("No billable services selected");
    }

    const session = await stripeService.createCheckoutSession({
      mode: "payment",
      success_url: stripeCheckoutUrls.successUrl,
      cancel_url: stripeCheckoutUrls.cancelUrl,
      payment_method_types: ["card"],
      line_items: items.map((item) => ({
        price_data: {
          currency: pricing.currency.toLowerCase(),
          unit_amount: this.toMinorAmount(item.unitPrice),
          product_data: {
            name: item.label,
          },
        },
        quantity: item.quantity,
      })),
      customer_email: contact.email,
      metadata: {
        userId: userId || "",
        serviceDate,
      },
    });

    if (!session.url) {
      throw new BadRequestException("Checkout session URL is missing");
    }

    const paymentIntentId = this.resolveStripeId(session.payment_intent);

    await this.paymentDraftRepository.create({
      userId,
      firstName: contact.firstName!,
      lastName: contact.lastName!,
      email: contact.email!,
      phoneNumber: contact.phoneNumber!,
      serviceDate,
      notes: payload.notes?.trim(),
      services: pricing.items,
      totalPrice: pricing.total,
      currency: pricing.currency,
      paymentIntentId,
      stripeSessionId: session.id,
      paymentAmount: amount,
      paymentStatus: "pending",
    });

    return {
      flow: "checkout",
      paymentIntentId,
      sessionId: session.id,
      checkoutUrl: session.url,
      amount,
      currency: pricing.currency,
    };
  }

  async confirmPayment(
    payload: {
      paymentIntentId?: string;
      checkoutSessionId?: string;
      paymentMethodId?: string;
    },
    requestUserId?: string,
  ): Promise<QuoteResponse> {
    if (payload.checkoutSessionId) {
      return this.confirmCheckoutSessionPayment(
        payload.checkoutSessionId,
        requestUserId,
      );
    }

    if (!payload.paymentIntentId) {
      throw new BadRequestException(
        "Payment intent or checkout session is required",
      );
    }

    const paymentIntentId = payload.paymentIntentId;
    const paymentMethodId = payload.paymentMethodId;
    const draft =
      await this.paymentDraftRepository.findByPaymentIntentId(paymentIntentId);

    if (!draft) {
      throw new NotFoundException("Payment draft not found");
    }

    if (
      draft.userId &&
      requestUserId &&
      draft.userId.toString() !== requestUserId
    ) {
      throw new UnauthorizedException("Unauthorized payment confirmation");
    }

    if (draft.paymentStatus === "completed" && draft.quoteId) {
      const existingQuote = await this.quoteRepository.findById(
        draft.quoteId.toString(),
      );
      if (existingQuote) {
        return this.toResponse(existingQuote);
      }
    }

    let paymentIntent =
      await stripeService.retrievePaymentIntent(paymentIntentId);

    if (paymentIntent.status !== "succeeded" && paymentMethodId) {
      paymentIntent = await stripeService.confirmPaymentIntent(
        paymentIntentId,
        paymentMethodId,
      );
    }

    if (paymentIntent.status === "requires_action") {
      throw new BadRequestException("Payment requires additional action");
    }

    if (paymentIntent.status !== "succeeded") {
      throw new BadRequestException("Payment has not succeeded");
    }

    if (
      paymentIntent.amount_received !== draft.paymentAmount ||
      paymentIntent.currency.toLowerCase() !== draft.currency.toLowerCase()
    ) {
      throw new BadRequestException("Payment details do not match draft");
    }

    const quote = await this.quoteRepository.create({
      userId: draft.userId,
      serviceType: QUOTE.SERVICE_TYPES.RESIDENTIAL,
      status: QUOTE.STATUSES.PAID,
      contactName: this.formatContactName(draft.firstName, draft.lastName),
      firstName: draft.firstName,
      lastName: draft.lastName,
      email: draft.email.toLowerCase(),
      phoneNumber: draft.phoneNumber,
      serviceDate: draft.serviceDate,
      notes: draft.notes,
      services: draft.services,
      totalPrice: draft.totalPrice,
      currency: draft.currency,
      paymentIntentId: draft.paymentIntentId,
      paymentAmount: draft.paymentAmount,
      paymentStatus: "paid",
      paidAt: new Date(paymentIntent.created * 1000),
    });

    draft.paymentStatus = "completed";
    draft.quoteId = quote._id.toString();
    await draft.save();

    return this.toResponse(quote);
  }

  async getPaymentStatus(
    payload: {
      paymentIntentId?: string;
      checkoutSessionId?: string;
    },
    requestUserId?: string,
  ): Promise<QuotePaymentStatusResponse> {
    if (payload.checkoutSessionId) {
      return this.getCheckoutSessionStatus(
        payload.checkoutSessionId,
        requestUserId,
      );
    }

    if (payload.paymentIntentId) {
      return this.getPaymentIntentStatus(
        payload.paymentIntentId,
        requestUserId,
      );
    }

    throw new BadRequestException(
      "Payment intent or checkout session is required",
    );
  }

  private async confirmCheckoutSessionPayment(
    checkoutSessionId: string,
    requestUserId?: string,
  ): Promise<QuoteResponse> {
    const draft =
      await this.paymentDraftRepository.findByStripeSessionId(
        checkoutSessionId,
      );

    if (!draft) {
      throw new NotFoundException("Payment draft not found");
    }

    if (
      draft.userId &&
      requestUserId &&
      draft.userId.toString() !== requestUserId
    ) {
      throw new UnauthorizedException("Unauthorized payment confirmation");
    }

    if (draft.paymentStatus === "completed" && draft.quoteId) {
      const existingQuote = await this.quoteRepository.findById(
        draft.quoteId.toString(),
      );
      if (existingQuote) {
        return this.toResponse(existingQuote);
      }
    }

    const session = await stripeService.retrieveCheckoutSession(
      checkoutSessionId,
      { expand: ["payment_intent"] },
    );

    if (
      session.payment_status !== "paid" &&
      session.payment_status !== "no_payment_required"
    ) {
      throw new BadRequestException("Payment has not succeeded");
    }

    const paymentIntent =
      session.payment_intent &&
      typeof session.payment_intent === "object" &&
      "amount_received" in session.payment_intent
        ? (session.payment_intent as Stripe.PaymentIntent)
        : undefined;

    if (paymentIntent && paymentIntent.status !== "succeeded") {
      throw new BadRequestException("Payment has not succeeded");
    }

    const amountReceived =
      paymentIntent?.amount_received ?? session.amount_total ?? undefined;
    const currency = paymentIntent?.currency ?? session.currency ?? undefined;

    if (
      amountReceived !== undefined &&
      amountReceived !== draft.paymentAmount
    ) {
      throw new BadRequestException("Payment details do not match draft");
    }

    if (currency && currency.toLowerCase() !== draft.currency.toLowerCase()) {
      throw new BadRequestException("Payment details do not match draft");
    }

    const paymentIntentId =
      paymentIntent?.id || this.resolveStripeId(session.payment_intent);

    const quote = await this.quoteRepository.create({
      userId: draft.userId,
      serviceType: QUOTE.SERVICE_TYPES.RESIDENTIAL,
      status: QUOTE.STATUSES.PAID,
      contactName: this.formatContactName(draft.firstName, draft.lastName),
      firstName: draft.firstName,
      lastName: draft.lastName,
      email: draft.email.toLowerCase(),
      phoneNumber: draft.phoneNumber,
      serviceDate: draft.serviceDate,
      notes: draft.notes,
      services: draft.services,
      totalPrice: draft.totalPrice,
      currency: draft.currency,
      paymentIntentId: paymentIntentId || draft.paymentIntentId,
      paymentAmount: draft.paymentAmount,
      paymentStatus: "paid",
      paidAt: paymentIntent
        ? new Date(paymentIntent.created * 1000)
        : new Date(),
    });

    draft.paymentStatus = "completed";
    draft.quoteId = quote._id.toString();
    if (paymentIntentId) {
      draft.paymentIntentId = paymentIntentId;
    }
    await draft.save();

    return this.toResponse(quote);
  }

  private async getCheckoutSessionStatus(
    checkoutSessionId: string,
    requestUserId?: string,
  ): Promise<QuotePaymentStatusResponse> {
    const draft =
      await this.paymentDraftRepository.findByStripeSessionId(
        checkoutSessionId,
      );

    if (!draft) {
      throw new NotFoundException("Payment draft not found");
    }

    if (
      draft.userId &&
      requestUserId &&
      draft.userId.toString() !== requestUserId
    ) {
      throw new UnauthorizedException("Unauthorized payment lookup");
    }

    const session = await stripeService.retrieveCheckoutSession(
      checkoutSessionId,
      { expand: ["payment_intent"] },
    );

    const status = this.mapCheckoutSessionStatus(session);
    const stripeStatus = session.payment_status || session.status || "unknown";
    const paymentIntentId =
      this.resolveStripeId(session.payment_intent) || draft.paymentIntentId;

    if (status === "paid" && draft.paymentStatus !== "completed") {
      draft.paymentStatus = "completed";
      if (paymentIntentId) {
        draft.paymentIntentId = paymentIntentId;
      }
      await draft.save();
    }

    return {
      status,
      checkoutSessionId,
      paymentIntentId,
      quoteId: draft.quoteId?.toString(),
      stripeStatus,
    };
  }

  private async getPaymentIntentStatus(
    paymentIntentId: string,
    requestUserId?: string,
  ): Promise<QuotePaymentStatusResponse> {
    const draft =
      await this.paymentDraftRepository.findByPaymentIntentId(paymentIntentId);

    if (!draft) {
      throw new NotFoundException("Payment draft not found");
    }

    if (
      draft.userId &&
      requestUserId &&
      draft.userId.toString() !== requestUserId
    ) {
      throw new UnauthorizedException("Unauthorized payment lookup");
    }

    const paymentIntent =
      await stripeService.retrievePaymentIntent(paymentIntentId);

    const status = this.mapPaymentIntentStatus(paymentIntent.status);

    if (status === "paid" && draft.paymentStatus !== "completed") {
      draft.paymentStatus = "completed";
      await draft.save();
    }

    return {
      status,
      paymentIntentId,
      checkoutSessionId: draft.stripeSessionId,
      quoteId: draft.quoteId?.toString(),
      stripeStatus: paymentIntent.status,
    };
  }

  async createServiceRequest(
    payload: QuoteRequestPayload,
    requestUserId?: string,
  ): Promise<QuoteResponse> {
    if (!this.isManualServiceType(payload.serviceType)) {
      throw new BadRequestException("Unsupported service type");
    }

    const { contact, userId } = await this.resolveRequestContact(
      payload,
      requestUserId,
    );

    const companyName = payload.companyName.trim();
    const businessAddress = payload.businessAddress.trim();
    const serviceDate = payload.preferredDate.trim();
    const preferredTime = payload.preferredTime.trim();
    const notes = payload.specialRequest.trim();

    const nameParts = this.splitFullName(contact.contactName!);

    const quote = await this.quoteRepository.create({
      userId,
      serviceType: payload.serviceType,
      status: QUOTE.STATUSES.SUBMITTED,
      contactName: contact.contactName,
      firstName: nameParts.firstName || undefined,
      lastName: nameParts.lastName || undefined,
      email: contact.email!.toLowerCase(),
      phoneNumber: contact.phoneNumber!,
      companyName,
      businessAddress,
      serviceDate,
      preferredTime,
      notes,
    });

    let finalQuote = quote;

    try {
      finalQuote = await this.notifyAdmin(quote);
    } catch (error) {
      logger.warn(
        { quoteId: quote._id.toString(), error },
        "Admin notification failed",
      );
    }

    return this.toResponse(finalQuote);
  }

  async updateStatus(
    quoteId: string,
    payload: QuoteStatusUpdatePayload,
  ): Promise<QuoteResponse> {
    const quote = await this.quoteRepository.findById(quoteId);

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      throw new BadRequestException(
        "Status updates are only supported for manual quotes",
      );
    }

    if (!this.isManualStatus(payload.status)) {
      throw new BadRequestException("Invalid status update");
    }

    const update: Partial<IQuote> = { status: payload.status };

    if (
      payload.status === QUOTE.STATUSES.ADMIN_NOTIFIED &&
      !quote.adminNotifiedAt
    ) {
      update.adminNotifiedAt = new Date();
    }

    const updated = await this.quoteRepository.updateById(quoteId, update);

    if (!updated) {
      throw new NotFoundException("Quote not found");
    }

    return this.toResponse(updated);
  }

  async assignCleaner(
    quoteId: string,
    payload: QuoteAssignCleanerPayload,
  ): Promise<QuoteResponse> {
    const quote = await this.quoteRepository.findById(quoteId);

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    if (serviceType !== QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      throw new BadRequestException(
        "Cleaner assignment is only supported for residential quotes",
      );
    }

    const cleaner = await this.userService.getById(payload.cleanerId);
    if (!cleaner) {
      throw new NotFoundException("Cleaner not found");
    }
    if (cleaner.role !== ROLES.CLEANER) {
      throw new BadRequestException("Assigned user is not a cleaner");
    }
    if (
      cleaner.cleanerPercentage === undefined ||
      cleaner.cleanerPercentage === null
    ) {
      throw new BadRequestException("Cleaner percentage is not configured");
    }

    const updated = await this.quoteRepository.updateById(quoteId, {
      assignedCleanerId: cleaner._id,
      assignedCleanerAt: new Date(),
      cleanerPercentage: cleaner.cleanerPercentage,
    });

    if (!updated) {
      throw new NotFoundException("Quote not found");
    }

    return this.toResponse(updated);
  }

  async getPaginated(
    filter: Record<string, any>,
    options: PaginateOptions,
  ): Promise<PaginateResult<IQuote>> {
    const finalFilter = { ...filter, isDeleted: { $ne: true } };
    return this.quoteRepository.paginate(finalFilter, options);
  }

  async getAll(
    filter: Record<string, any> = {},
    options: Record<string, any> = {},
  ): Promise<IQuote[]> {
    return this.quoteRepository.findAll(filter, {
      sort: { createdAt: -1 },
      ...options,
    });
  }

  async getCleanerEarnings(
    cleanerId: string,
  ): Promise<{ totalEarnings: number; totalJobs: number; currency: string }> {
    const result = await this.quoteRepository.sumCleanerEarnings(cleanerId);

    return {
      totalEarnings: Number(result.total || 0),
      totalJobs: result.count || 0,
      currency: QUOTE.CURRENCY,
    };
  }

  async getByIdForAccess(
    quoteId: string,
    requester: { userId: string; role: string },
  ): Promise<QuoteResponse> {
    const quote = await this.quoteRepository.findById(quoteId);

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (
      requester.role === ROLES.ADMIN ||
      requester.role === ROLES.SUPER_ADMIN
    ) {
      return this.toResponse(quote);
    }

    if (requester.role === ROLES.CLEANER) {
      if (
        !quote.assignedCleanerId ||
        quote.assignedCleanerId.toString() !== requester.userId
      ) {
        throw new ForbiddenException("Cleaner is not assigned to this quote");
      }
      return this.toResponse(quote);
    }

    if (requester.role === ROLES.CLIENT) {
      if (!quote.userId || quote.userId.toString() !== requester.userId) {
        throw new ForbiddenException("Client does not own this quote");
      }
      return this.toResponse(quote);
    }

    throw new ForbiddenException("User is not authorized to access this quote");
  }

  async markArrived(quoteId: string, clientId: string): Promise<QuoteResponse> {
    const quote = await this.quoteRepository.findById(quoteId);

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (quote.serviceType !== QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      throw new BadRequestException(
        "Arrival updates are only supported for residential quotes",
      );
    }

    if (!quote.userId || quote.userId.toString() !== clientId) {
      throw new ForbiddenException("Client does not own this quote");
    }

    const currentStatus =
      quote.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING;

    if (currentStatus === QUOTE.CLEANING_STATUSES.COMPLETED) {
      throw new BadRequestException("Cleaning is already completed");
    }

    if (currentStatus === QUOTE.CLEANING_STATUSES.IN_PROGRESS) {
      return this.toResponse(quote);
    }

    const updated = await this.quoteRepository.updateById(quoteId, {
      cleaningStatus: QUOTE.CLEANING_STATUSES.IN_PROGRESS,
    });

    if (!updated) {
      throw new NotFoundException("Quote not found");
    }

    return this.toResponse(updated);
  }

  private async resolveContact(
    payload: QuoteCreatePayload,
    requestUserId?: string,
  ): Promise<{ contact: QuoteContact; userId?: string }> {
    const contact: QuoteContact = {
      firstName: payload.firstName?.trim(),
      lastName: payload.lastName?.trim(),
      email: payload.email?.trim().toLowerCase(),
      phoneNumber: payload.phoneNumber?.trim(),
    };

    let resolvedUserId: string | undefined;

    if (requestUserId) {
      const user = await this.userService.getById(requestUserId);
      if (user) {
        resolvedUserId = user._id.toString();
        if (!contact.email) {
          contact.email = user.email;
        }
        if (!contact.phoneNumber) {
          contact.phoneNumber = user.phoneNumber;
        }
        if (!contact.firstName || !contact.lastName) {
          const parsed = this.splitFullName(user.fullName);
          contact.firstName = contact.firstName || parsed.firstName;
          contact.lastName = contact.lastName || parsed.lastName;
        }
      } else {
        logger.warn({ requestUserId }, "Authenticated quote user not found");
      }
    }

    this.ensureContact(contact);

    return { contact, userId: resolvedUserId };
  }

  private async resolveRequestContact(
    payload: QuoteRequestPayload,
    requestUserId?: string,
  ): Promise<{ contact: QuoteRequestContact; userId?: string }> {
    const contact: QuoteRequestContact = {
      contactName: payload.name?.trim(),
      email: payload.email?.trim().toLowerCase(),
      phoneNumber: payload.phoneNumber?.trim(),
    };

    let resolvedUserId: string | undefined;

    if (requestUserId) {
      const user = await this.userService.getById(requestUserId);
      if (user) {
        resolvedUserId = user._id.toString();
        if (!contact.contactName) {
          contact.contactName = user.fullName;
        }
        if (!contact.email) {
          contact.email = user.email;
        }
        if (!contact.phoneNumber && user.phoneNumber) {
          contact.phoneNumber = user.phoneNumber;
        }
      } else {
        logger.warn({ requestUserId }, "Authenticated quote user not found");
      }
    }

    this.ensureRequestContact(contact);

    return { contact, userId: resolvedUserId };
  }

  private splitFullName(fullName: string): {
    firstName: string;
    lastName: string;
  } {
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts.shift() || "";
    const lastName = parts.join(" ").trim();
    return { firstName, lastName };
  }

  private ensureContact(contact: QuoteContact): void {
    if (!contact.firstName) {
      throw new BadRequestException("First name is required");
    }
    if (!contact.lastName) {
      throw new BadRequestException("Last name is required");
    }
    if (!contact.email) {
      throw new BadRequestException("Email address is required");
    }
    if (!contact.phoneNumber) {
      throw new BadRequestException("Phone number is required");
    }
  }

  private ensureRequestContact(contact: QuoteRequestContact): void {
    if (!contact.contactName) {
      throw new BadRequestException("Name is required");
    }
    if (!contact.email) {
      throw new BadRequestException("Email address is required");
    }
    if (!contact.phoneNumber) {
      throw new BadRequestException("Phone number is required");
    }
  }

  private async notifyAdmin(quote: IQuote): Promise<IQuote> {
    const requestedServices = this.resolveRequestedServices(quote);
    const clientName = this.resolveContactName(quote);

    await this.notificationRepository.createOnce({
      quoteId: quote._id.toString(),
      event: "quote_submitted",
      serviceType: quote.serviceType,
      clientName,
      companyName: quote.companyName,
      email: quote.email,
      phoneNumber: quote.phoneNumber,
      businessAddress: quote.businessAddress,
      serviceDate: quote.serviceDate,
      preferredTime: quote.preferredTime,
      requestedServices,
      notes: quote.notes,
    });

    const update: Partial<IQuote> = {
      adminNotifiedAt: new Date(),
    };

    if (!quote.status || quote.status === QUOTE.STATUSES.SUBMITTED) {
      update.status = QUOTE.STATUSES.ADMIN_NOTIFIED;
    }

    const updated = await this.quoteRepository.updateById(
      quote._id.toString(),
      update,
    );

    return updated || quote;
  }

  private isManualServiceType(serviceType: string): boolean {
    return (
      serviceType === QUOTE.SERVICE_TYPES.COMMERCIAL ||
      serviceType === QUOTE.SERVICE_TYPES.POST_CONSTRUCTION
    );
  }

  private isManualStatus(status: string): boolean {
    return (
      status === QUOTE.STATUSES.ADMIN_NOTIFIED ||
      status === QUOTE.STATUSES.REVIEWED ||
      status === QUOTE.STATUSES.CONTACTED
    );
  }

  private resolveRequestedServices(quote: IQuote): string[] {
    if (quote.services && quote.services.length > 0) {
      return quote.services.map((service) => service.label);
    }

    return [this.serviceTypeLabel(quote.serviceType)];
  }

  private serviceTypeLabel(serviceType: string): string {
    switch (serviceType) {
      case QUOTE.SERVICE_TYPES.COMMERCIAL:
        return "Commercial Cleaning";
      case QUOTE.SERVICE_TYPES.POST_CONSTRUCTION:
        return "Post-Construction Cleaning";
      default:
        return "Residential Cleaning";
    }
  }

  private resolveContactName(quote: IQuote): string {
    return (
      quote.contactName ||
      this.formatContactName(quote.firstName, quote.lastName) ||
      quote.email
    );
  }

  private formatContactName(
    firstName?: string,
    lastName?: string,
  ): string | undefined {
    const parts = [firstName, lastName].filter(Boolean);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join(" ").trim();
  }

  private normalizeServiceSelections(
    selections: QuoteCreatePayload["services"],
  ): QuoteCreatePayload["services"] {
    const normalized: QuoteCreatePayload["services"] = {};
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
    selections: QuoteCreatePayload["services"],
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

  toResponse(quote: IQuote): QuoteResponse {
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const status =
      quote.status ||
      (quote.paymentStatus === "paid" ? QUOTE.STATUSES.PAID : undefined);
    const cleaningStatus =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING
        : undefined;
    const reportStatus =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.reportStatus
        : undefined;
    const cleanerPercentage =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.cleanerPercentage
        : undefined;
    const cleanerEarningAmount =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.cleanerEarningAmount
        : undefined;

    return {
      _id: quote._id.toString(),
      userId: quote.userId?.toString(),
      serviceType,
      status,
      contactName:
        quote.contactName ||
        this.formatContactName(quote.firstName, quote.lastName),
      firstName: quote.firstName,
      lastName: quote.lastName,
      email: quote.email,
      phoneNumber: quote.phoneNumber,
      companyName: quote.companyName,
      businessAddress: quote.businessAddress,
      serviceDate: quote.serviceDate,
      preferredTime: quote.preferredTime,
      notes: quote.notes,
      services: quote.services,
      totalPrice: quote.totalPrice,
      currency: quote.currency,
      paymentIntentId: quote.paymentIntentId,
      paymentAmount: quote.paymentAmount,
      paymentStatus: quote.paymentStatus,
      paidAt: quote.paidAt,
      adminNotifiedAt: quote.adminNotifiedAt,
      assignedCleanerId: quote.assignedCleanerId?.toString(),
      assignedCleanerAt: quote.assignedCleanerAt,
      cleaningStatus,
      reportStatus,
      cleanerPercentage,
      cleanerEarningAmount,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }

  private toMinorAmount(amount: number): number {
    return Math.round(amount * 100);
  }

  private mapCheckoutSessionStatus(
    session: Stripe.Checkout.Session,
  ): QuotePaymentStatusResponse["status"] {
    if (session.payment_status === "paid") {
      return "paid";
    }
    if (session.payment_status === "no_payment_required") {
      return "paid";
    }
    if (session.status === "expired") {
      return "failed";
    }
    return "pending";
  }

  private mapPaymentIntentStatus(
    status: Stripe.PaymentIntent.Status,
  ): QuotePaymentStatusResponse["status"] {
    if (status === "succeeded") {
      return "paid";
    }
    if (status === "canceled") {
      return "failed";
    }
    return "pending";
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
