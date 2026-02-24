import { QUOTE, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { realtimeService } from "@/services/realtime.service";
import { stripeService } from "@/services/stripe.service";
import type { PaginateResult } from "@/ts/pagination.types";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@/utils/app-error.utils";
import type { PaginateOptions } from "mongoose";
import { Types } from "mongoose";
import type Stripe from "stripe";
import { stripeCheckoutUrls } from "../billing/billing.config";
import { CleaningReportRepository } from "../cleaning-report/cleaning-report.repository";
import { CleaningServiceService } from "../cleaning-service/cleaning-service.service";
import { UserService } from "../user/user.service";
import type { IUser } from "../user/user.interface";
import { QuoteNotificationRepository } from "./quote-notification.repository";
import { QuotePaymentDraftRepository } from "./quote-payment.repository";
import type { IQuote } from "./quote.interface";
import { QuotePricingService } from "./quote.pricing";
import { QuoteRepository } from "./quote.repository";
import { formatTimeTo12Hour, normalizeTimeTo24Hour } from "@/utils/time.utils";
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
  private emailService: EmailService;
  private pricingService: QuotePricingService;
  private cleaningServiceService: CleaningServiceService;
  private userService: UserService;
  private cleaningReportRepository: CleaningReportRepository;

  constructor() {
    this.quoteRepository = new QuoteRepository();
    this.paymentDraftRepository = new QuotePaymentDraftRepository();
    this.notificationRepository = new QuoteNotificationRepository();
    this.emailService = new EmailService();
    this.pricingService = new QuotePricingService();
    this.cleaningServiceService = new CleaningServiceService();
    this.userService = new UserService();
    this.cleaningReportRepository = new CleaningReportRepository();
  }

  async createPaymentIntent(
    payload: QuoteCreatePayload,
    requestUserId?: string,
  ): Promise<QuotePaymentIntentResponse> {
    const { contact, userId } = await this.resolveContact(
      payload,
      requestUserId,
    );
    const preferredTime = normalizeTimeTo24Hour(payload.preferredTime);
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
          preferredTime,
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
        preferredTime,
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
        preferredTime,
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
      preferredTime,
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

    // Idempotency guard: if a quote already exists for this payment intent, return it
    const existingQuote =
      await this.quoteRepository.findByPaymentIntentId(paymentIntentId);
    if (existingQuote) {
      return this.toResponse(existingQuote);
    }

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
      preferredTime: draft.preferredTime,
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

    const finalQuote = await this.notifyStakeholdersOnQuoteCreated(quote);
    return this.toResponse(finalQuote);
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

    // Idempotency guard: if a quote already exists for this payment intent, return it
    if (paymentIntentId) {
      const existing =
        await this.quoteRepository.findByPaymentIntentId(paymentIntentId);
      if (existing) {
        return this.toResponse(existing);
      }
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
      preferredTime: draft.preferredTime,
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

    const finalQuote = await this.notifyStakeholdersOnQuoteCreated(quote);
    return this.toResponse(finalQuote);
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
      serviceDate: draft.serviceDate,
      preferredTime: draft.preferredTime,
      paymentAmount: draft.paymentAmount,
      currency: draft.currency,
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
      serviceDate: draft.serviceDate,
      preferredTime: draft.preferredTime,
      paymentAmount: draft.paymentAmount,
      currency: draft.currency,
    };
  }

  async createServiceRequest(
    payload: QuoteRequestPayload,
    requestUserId?: string,
  ): Promise<QuoteResponse> {
    if (!this.isManualServiceType(payload.serviceType)) {
      throw new BadRequestException("Unsupported service type");
    }

    const { contact, userId, createdByRole } = await this.resolveRequestContact(
      payload,
      requestUserId,
    );

    const companyName = payload.companyName.trim();
    const businessAddress = payload.businessAddress.trim();
    const serviceDate = payload.preferredDate.trim();
    const preferredTime = normalizeTimeTo24Hour(payload.preferredTime);
    const cleaningFrequency = this.normalizeCleaningFrequency(
      payload.cleaningFrequency,
    );
    const notes = payload.specialRequest?.trim() || undefined;
    const totalPrice =
      payload.totalPrice !== undefined && payload.totalPrice !== null
        ? Number(payload.totalPrice)
        : undefined;
    const cleanerPrice =
      payload.cleanerPrice !== undefined && payload.cleanerPrice !== null
        ? Number(payload.cleanerPrice)
        : undefined;
    const cleaningServices = Array.from(
      new Set(payload.cleaningServices || []),
    )
      .map((service) => service.trim())
      .filter(Boolean);
    const generalContractorName =
      payload.generalContractorName?.trim() || undefined;
    const generalContractorPhone =
      payload.generalContractorPhone?.trim() || undefined;
    const assignedCleanerIds = Array.from(
      new Set(payload.assignedCleanerIds || []),
    ).filter(Boolean);

    const nameParts = this.splitFullName(contact.contactName!);

    const quote = await this.quoteRepository.create({
      userId,
      serviceType: payload.serviceType,
      createdByRole,
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
      totalPrice: Number.isFinite(totalPrice) ? totalPrice : undefined,
      cleanerEarningAmount: Number.isFinite(cleanerPrice)
        ? cleanerPrice
        : undefined,
      cleaningFrequency,
      squareFoot:
        payload.squareFoot !== undefined && payload.squareFoot !== null
          ? Number(payload.squareFoot)
          : undefined,
      cleaningServices: cleaningServices.length ? cleaningServices : undefined,
      generalContractorName,
      generalContractorPhone,
      paymentStatus: this.isManualServiceType(payload.serviceType)
        ? "manual"
        : "unpaid",
      assignedCleanerIds: assignedCleanerIds.length
        ? assignedCleanerIds
        : undefined,
      assignedCleanerId: assignedCleanerIds[0],
      assignedCleanerAt: assignedCleanerIds.length ? new Date() : undefined,
      currency: QUOTE.CURRENCY,
    });

    const finalQuote = await this.notifyStakeholdersOnQuoteCreated(quote);
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

    const shouldNotifyCleanerOnClose =
      payload.status === QUOTE.STATUSES.CLOSED &&
      quote.status !== QUOTE.STATUSES.CLOSED;

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

    if (shouldNotifyCleanerOnClose) {
      try {
        await this.notifyCleanersOnManualBookingClosed(updated);
      } catch (error) {
        logger.warn(
          { quoteId: updated._id.toString(), error },
          "Cleaner closed-booking notification failed",
        );
      }
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

    const previousCleanerIds = this.extractAssignedCleanerIds(quote);
    const hadPreviousAssignment = previousCleanerIds.length > 0;

    const cleanerIds = payload.cleanerIds?.length
      ? payload.cleanerIds
      : payload.cleanerId
        ? [payload.cleanerId]
        : [];

    if (cleanerIds.length === 0) {
      throw new BadRequestException("Cleaner id is required");
    }

    const uniqueCleanerIds = Array.from(new Set(cleanerIds));
    const assignmentChanged = !this.haveSameIdSet(
      previousCleanerIds,
      uniqueCleanerIds,
    );
    const cleaners = await Promise.all(
      uniqueCleanerIds.map(async (id) => {
        const cleaner = await this.userService.getById(id);
        if (!cleaner) {
          throw new NotFoundException(`Cleaner not found: ${id}`);
        }
        if (cleaner.role !== ROLES.CLEANER) {
          throw new BadRequestException(
            `Assigned user is not a cleaner: ${id}`,
          );
        }
        return cleaner;
      }),
    );

    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const primaryCleaner = cleaners[0];
    const cleanerCount = cleaners.length;

    let cleanerSharePercentage: number | undefined =
      payload.cleanerSharePercentage;
    if (
      cleanerSharePercentage === undefined ||
      cleanerSharePercentage === null
    ) {
      if (cleanerCount > 1) {
        throw new BadRequestException(
          "cleanerSharePercentage is required when assigning multiple cleaners",
        );
      }
      cleanerSharePercentage = primaryCleaner.cleanerPercentage;
    }

    if (
      cleanerSharePercentage === undefined ||
      cleanerSharePercentage === null ||
      Number.isNaN(cleanerSharePercentage)
    ) {
      throw new BadRequestException(
        "Cleaner share percentage is not configured",
      );
    }

    if (cleanerSharePercentage < 0 || cleanerSharePercentage > 100) {
      throw new BadRequestException(
        "Cleaner share percentage must be between 0 and 100",
      );
    }

    const perCleanerPercentage =
      cleanerCount > 0
        ? Number((cleanerSharePercentage / cleanerCount).toFixed(4))
        : cleanerSharePercentage;

    const updated = await this.quoteRepository.updateById(quoteId, {
      assignedCleanerId: primaryCleaner._id,
      assignedCleanerIds: cleaners.map((c) => c._id),
      assignedCleanerAt: new Date(),
      cleanerSharePercentage,
      cleanerPercentage: perCleanerPercentage,
    });

    if (!updated) {
      throw new NotFoundException("Quote not found");
    }

    if (!hadPreviousAssignment || assignmentChanged) {
      await this.notifyOnCleanerAssignmentChange({
        quote,
        quoteId: updated._id.toString(),
        cleaners,
        assignmentType: hadPreviousAssignment ? "reassigned" : "assigned",
      });
    }

    return this.toResponse(updated);
  }

  private extractAssignedCleanerIds(quote: IQuote): string[] {
    return Array.from(
      new Set(
        [
          quote.assignedCleanerId?.toString(),
          ...(quote.assignedCleanerIds || []).map((id) => id.toString()),
        ].filter((id): id is string => Boolean(id)),
      ),
    );
  }

  private haveSameIdSet(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    const leftSet = new Set(left.map(String));
    return right.every((id) => leftSet.has(String(id)));
  }

  private async notifyOnCleanerAssignmentChange(params: {
    quote: IQuote;
    quoteId: string;
    cleaners: IUser[];
    assignmentType: "assigned" | "reassigned";
  }): Promise<void> {
    const { quote, quoteId, cleaners, assignmentType } = params;
    const cleanerNames = cleaners
      .map((cleaner) => cleaner.fullName?.trim())
      .filter((name): name is string => Boolean(name));
    const serviceType = this.serviceTypeLabel(quote.serviceType);
    const preferredTime = formatTimeTo12Hour(quote.preferredTime);
    const clientName = this.resolveContactName(quote);
    const createdAt = new Date().toISOString();
    const isReassignment = assignmentType === "reassigned";

    const cleanerRealtimeTitle = isReassignment
      ? "Booking assignment updated"
      : "New booking assigned";
    const cleanerRealtimeMessage = isReassignment
      ? `Your assignment was updated for booking #${quoteId}.`
      : `You have been assigned to booking #${quoteId}.`;

    cleaners.forEach((cleaner) => {
      const cleanerId = cleaner._id?.toString();
      if (!cleanerId) return;

      realtimeService.emitQuoteAssignmentNotification({
        userId: cleanerId,
        recipientType: "cleaner",
        quoteId,
        assignmentType,
        title: cleanerRealtimeTitle,
        message: cleanerRealtimeMessage,
        serviceType,
        serviceDate: quote.serviceDate,
        preferredTime,
        createdAt,
      });
    });

    const clientUserId = quote.userId?.toString();
    if (clientUserId) {
      const cleanerNamesText = cleanerNames.length
        ? ` (${cleanerNames.join(", ")})`
        : "";
      realtimeService.emitQuoteAssignmentNotification({
        userId: clientUserId,
        recipientType: "client",
        quoteId,
        assignmentType,
        title: isReassignment
          ? "Cleaner assignment updated"
          : "Cleaner assigned to your booking",
        message: isReassignment
          ? `Your booking #${quoteId} cleaner assignment was updated${cleanerNamesText}.`
          : `A cleaner has been assigned to your booking #${quoteId}${cleanerNamesText}.`,
        serviceType,
        serviceDate: quote.serviceDate,
        preferredTime,
        createdAt,
      });
    }

    const emailTasks: Promise<void>[] = [];

    cleaners.forEach((cleaner) => {
      const cleanerEmail = cleaner.email?.trim().toLowerCase();
      if (!cleanerEmail) return;

      emailTasks.push(
        this.emailService
          .sendCleanerAssignmentNotification({
            to: cleanerEmail,
            cleanerName: cleaner.fullName || "Cleaner",
            bookingId: quoteId,
            assignmentType,
            serviceType,
            serviceDate: quote.serviceDate,
            preferredTime,
            companyName: quote.companyName,
            businessAddress: quote.businessAddress,
            clientName,
          })
          .catch((error) => {
            logger.warn(
              { quoteId, cleanerId: cleaner._id?.toString(), cleanerEmail, error },
              "Cleaner assignment notification email failed",
            );
          }),
      );
    });

    const clientEmail = quote.email?.trim().toLowerCase();
    if (clientEmail) {
      emailTasks.push(
        this.emailService
          .sendClientCleanerAssignmentNotification({
            to: clientEmail,
            clientName,
            bookingId: quoteId,
            assignmentType,
            serviceType,
            serviceDate: quote.serviceDate,
            preferredTime,
            cleanerNames,
            companyName: quote.companyName,
            businessAddress: quote.businessAddress,
          })
          .catch((error) => {
            logger.warn(
              { quoteId, clientEmail, error },
              "Client cleaner assignment notification email failed",
            );
          }),
      );
    }

    if (emailTasks.length > 0) {
      await Promise.allSettled(emailTasks);
    }
  }

  private async notifyCleanersOnManualBookingClosed(quote: IQuote): Promise<void> {
    const cleanerIds = this.extractAssignedCleanerIds(quote);
    if (cleanerIds.length === 0) {
      return;
    }

    const cleaners = (
      await Promise.all(
        cleanerIds.map(async (id) => {
          try {
            const user = await this.userService.getById(id);
            if (!user || user.role !== ROLES.CLEANER) {
              return null;
            }
            return user;
          } catch (error) {
            logger.warn(
              { quoteId: quote._id.toString(), cleanerId: id, error },
              "Failed to load cleaner for closed-booking notification",
            );
            return null;
          }
        }),
      )
    ).filter((cleaner): cleaner is IUser => Boolean(cleaner));

    if (cleaners.length === 0) {
      return;
    }

    const quoteId = quote._id.toString();
    const serviceType = this.serviceTypeLabel(quote.serviceType);
    const preferredTime = formatTimeTo12Hour(quote.preferredTime);
    const createdAt = new Date().toISOString();

    cleaners.forEach((cleaner) => {
      const cleanerId = cleaner._id?.toString();
      if (!cleanerId) return;

      realtimeService.emitQuoteStatusNotification({
        userId: cleanerId,
        recipientType: "cleaner",
        quoteId,
        status: QUOTE.STATUSES.CLOSED,
        title: "Booking closed",
        message: `Booking #${quoteId} has been closed by admin.`,
        serviceType,
        serviceDate: quote.serviceDate,
        preferredTime,
        createdAt,
      });
    });

    const emailTasks = cleaners.map((cleaner) => {
      const cleanerEmail = cleaner.email?.trim().toLowerCase();
      if (!cleanerEmail) {
        return Promise.resolve();
      }

      return this.emailService
        .sendCleanerBookingClosedNotification({
          to: cleanerEmail,
          cleanerName: cleaner.fullName || "Cleaner",
          bookingId: quoteId,
          serviceType,
          serviceDate: quote.serviceDate,
          preferredTime,
          companyName: quote.companyName,
          businessAddress: quote.businessAddress,
        })
        .catch((error) => {
          logger.warn(
            { quoteId, cleanerId: cleaner._id?.toString(), cleanerEmail, error },
            "Cleaner closed-booking email failed",
          );
        });
    });

    await Promise.allSettled(emailTasks);
  }

  toCleanerFacingResponse(quote: IQuote, base?: QuoteResponse): QuoteResponse {
    const response = base || this.toResponse(quote);
    const allocatedAmount = this.resolveCleanerAllocatedAmountForQuote(quote);
    const isCompleted = this.isQuoteCompletedForCleanerPayment(quote);

    return {
      ...response,
      cleanerEarningAmount: Number(allocatedAmount.toFixed(2)),
      paymentStatus: isCompleted ? "paid" : "pending",
    };
  }

  private isQuoteCompletedForCleanerPayment(quote: IQuote): boolean {
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const status = (quote.status || "").toLowerCase();
    const reportStatus = (quote.reportStatus || "").toLowerCase();

    if (serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      return (
        reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
        status === QUOTE.STATUSES.COMPLETED ||
        status === QUOTE.STATUSES.REVIEWED
      );
    }

    return (
      status === QUOTE.STATUSES.CLOSED ||
      status === QUOTE.STATUSES.COMPLETED ||
      status === QUOTE.STATUSES.REVIEWED
    );
  }

  private resolveCleanerAllocatedAmountForQuote(quote: IQuote): number {
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const cleanerCount = this.resolveAssignedCleanerCount(quote);
    const rawCleanerAmount = this.asFiniteNumber(quote.cleanerEarningAmount);
    const totalPrice =
      this.asFiniteNumber(quote.totalPrice) ??
      this.asFiniteNumber(quote.paymentAmount);
    const totalSharePct = this.asFiniteNumber(quote.cleanerSharePercentage);
    const perCleanerPct =
      this.asFiniteNumber(quote.cleanerPercentage) ??
      (totalSharePct !== undefined
        ? totalSharePct / Math.max(cleanerCount, 1)
        : undefined);

    if (
      totalPrice !== undefined &&
      perCleanerPct !== undefined &&
      perCleanerPct > 0
    ) {
      return Number(((totalPrice * perCleanerPct) / 100).toFixed(2));
    }

    if (rawCleanerAmount !== undefined) {
      if (this.isManualServiceType(serviceType)) {
        return Number((rawCleanerAmount / Math.max(cleanerCount, 1)).toFixed(2));
      }
      return Number(rawCleanerAmount.toFixed(2));
    }

    return 0;
  }

  private resolveAssignedCleanerCount(quote: IQuote): number {
    const ids = this.extractAssignedCleanerIds(quote);
    return ids.length > 0 ? ids.length : 1;
  }

  private asFiniteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
  }

  async deleteQuote(quoteId: string): Promise<void> {
    const quote = await this.quoteRepository.findById(quoteId);
    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    const deleted = await this.quoteRepository.updateById(quoteId, {
      isDeleted: true as any,
      deletedAt: new Date(),
    });

    if (!deleted) {
      throw new NotFoundException("Quote not found");
    }
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
  ): Promise<{
    totalEarning: number;
    paidAmount: number;
    pendingAmount: number;
    totalJobs: number;
    currency: string;
  }> {
    const objectId = new Types.ObjectId(cleanerId);
    const quotes = await this.quoteRepository.findAll({
      $or: [
        { assignedCleanerId: objectId },
        { assignedCleanerIds: objectId },
      ],
    });

    const result = quotes.reduce(
      (acc, quote) => {
        const amount = this.resolveCleanerAllocatedAmountForQuote(quote as IQuote);
        const roundedAmount = Number(amount.toFixed(2));

        acc.totalJobs += 1;
        acc.totalEarning += roundedAmount;

        if (this.isQuoteCompletedForCleanerPayment(quote as IQuote)) {
          acc.paidAmount += roundedAmount;
        } else {
          acc.pendingAmount += roundedAmount;
        }

        return acc;
      },
      { totalEarning: 0, paidAmount: 0, pendingAmount: 0, totalJobs: 0 },
    );

    return {
      totalEarning: Number((result.totalEarning || 0).toFixed(2)),
      paidAmount: Number((result.paidAmount || 0).toFixed(2)),
      pendingAmount: Number((result.pendingAmount || 0).toFixed(2)),
      totalJobs: result.totalJobs || 0,
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
      let response = await this.buildResponseWithCleanerDetails(quote);
      response = this.toCleanerFacingResponse(quote, response);
      await this.attachCleaningReport(response, quote);
      return response;
    }

    if (requester.role === ROLES.CLEANER) {
      const isPrimary =
        quote.assignedCleanerId &&
        quote.assignedCleanerId.toString() === requester.userId;
      const isInList =
        quote.assignedCleanerIds &&
        quote.assignedCleanerIds
          .map((id) => id.toString())
          .includes(requester.userId);
      if (!isPrimary && !isInList) {
        throw new ForbiddenException("Cleaner is not assigned to this quote");
      }
      const response = await this.buildResponseWithCleanerDetails(quote);
      await this.attachCleaningReport(response, quote);
      return response;
    }

    if (requester.role === ROLES.CLIENT) {
      if (!quote.userId || quote.userId.toString() !== requester.userId) {
        throw new ForbiddenException("Client does not own this quote");
      }
      const response = await this.buildResponseWithCleanerDetails(quote);
      await this.attachCleaningReport(response, quote);
      return response;
    }

    throw new ForbiddenException("User is not authorized to access this quote");
  }

  private async buildResponseWithCleanerDetails(
    quote: IQuote,
  ): Promise<QuoteResponse> {
    const response = this.toResponse(quote);
    const ids = [
      ...(quote.assignedCleanerIds || []).map((id) => id.toString()),
      quote.assignedCleanerId ? quote.assignedCleanerId.toString() : "",
    ].filter(Boolean);

    await this.appendClientAddress(response, quote);

    if (!ids.length) {
      return response;
    }

    try {
      const cleaners = await this.userService.getUsersByIds(ids);
      response.assignedCleaners = cleaners.map((c) => ({
        _id: c._id,
        fullName: c.fullName,
        email: c.email,
        phone: c.phone,
      }));
    } catch (error) {
      logger.warn(
        { quoteId: quote._id.toString(), error },
        "Failed to load assigned cleaner details",
      );
    }

    return response;
  }

  private async appendClientAddress(
    response: QuoteResponse,
    quote: IQuote,
  ): Promise<void> {
    if (!quote.userId) {
      return;
    }

    try {
      const user = await this.userService.getById(quote.userId.toString());
      if (user?.address) {
        response.clientAddress = user.address;
      }
    } catch (error) {
      logger.warn(
        { quoteId: quote._id.toString(), error },
        "Failed to load client address",
      );
    }
  }

  /**
   * Enriches a list response with client addresses without performing
   * per-row database lookups. We fetch all relevant users in a single query
   * and map their addresses back onto the corresponding quote responses.
   */
  async toListResponsesWithClientAddress(
    quotes: IQuote[],
  ): Promise<QuoteResponse[]> {
    const responses = quotes.map((quote) => this.toResponse(quote));

    const userIds = Array.from(
      new Set(
        quotes
          .map((q) => q.userId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (!userIds.length) {
      return responses;
    }

      try {
        const users = await this.userService.getUsersByIds(userIds);
        const addressMap = new Map(
          users
            .filter((u) => Boolean(u.address))
            .map((u) => [u._id.toString(), u.address!]),
        );
        const roleMap = new Map(
          users.map((u) => [u._id.toString(), u.role]),
        );

        responses.forEach((res, idx) => {
          const uid = quotes[idx].userId?.toString();
          if (uid && addressMap.has(uid)) {
            res.clientAddress = addressMap.get(uid);
          }
          if (uid && !res.createdByRole && roleMap.has(uid)) {
            res.createdByRole = roleMap.get(uid);
          }
        });
    } catch (error) {
      logger.warn(
        { userIds },
        "Failed to append client addresses to quote list",
      );
    }

    return responses;
  }

  private async attachCleaningReport(
    response: QuoteResponse,
    quote: IQuote,
  ): Promise<void> {
    if (quote.serviceType !== QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      return;
    }

    const report = await this.cleaningReportRepository.findByQuoteId(
      quote._id.toString(),
    );
    if (!report) {
      return;
    }

    response.cleaningReport = {
      arrivalTime: report.arrivalTime,
      startTime: report.startTime,
      endTime: report.endTime,
      notes: report.notes,
      beforePhotos: report.beforePhotos || [],
      afterPhotos: report.afterPhotos || [],
      status: report.status,
      createdAt: report.createdAt,
    };
  }

  async markArrived(
    quoteId: string,
    requester: { userId: string; role: string },
  ): Promise<QuoteResponse> {
    const quote = await this.quoteRepository.findById(quoteId);

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (quote.serviceType !== QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      throw new BadRequestException(
        "Arrival updates are only supported for residential quotes",
      );
    }

    const requesterId = requester.userId?.toString();
    const isClient =
      requester.role === ROLES.CLIENT &&
      quote.userId &&
      quote.userId.toString() === requesterId;
    const isAssignedCleaner =
      requester.role === ROLES.CLEANER &&
      requesterId &&
      ((quote.assignedCleanerId &&
        quote.assignedCleanerId.toString() === requesterId) ||
        (quote.assignedCleanerIds || [])
          .map((id) => id.toString())
          .includes(requesterId));

    if (!isClient && !isAssignedCleaner) {
      throw new ForbiddenException("User is not allowed to update this quote");
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
  ): Promise<{
    contact: QuoteRequestContact;
    userId?: string;
    createdByRole?: string;
  }> {
    const contact: QuoteRequestContact = {
      contactName: payload.name?.trim(),
      email: payload.email?.trim().toLowerCase(),
      phoneNumber: payload.phoneNumber?.trim(),
    };

    let resolvedUserId: string | undefined;
    let createdByRole: string | undefined;

    if (requestUserId) {
      const user = await this.userService.getById(requestUserId);
      if (user) {
        resolvedUserId = user._id.toString();
        createdByRole = user.role;
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

    return {
      contact,
      userId: resolvedUserId,
      createdByRole: createdByRole || "guest",
    };
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
    const preferredTime = formatTimeTo12Hour(quote.preferredTime);

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
      preferredTime,
      requestedServices,
      notes: quote.notes,
    });

    const createdByRole = (quote.createdByRole || "").toLowerCase();
    const isAdminCreated =
      createdByRole === ROLES.ADMIN || createdByRole === ROLES.SUPER_ADMIN;

    if (!isAdminCreated) {
      realtimeService.emitAdminQuoteCreated({
        quoteId: quote._id.toString(),
        serviceType: this.serviceTypeLabel(quote.serviceType),
        clientName,
        clientEmail: quote.email,
        serviceDate: quote.serviceDate,
        preferredTime,
        companyName: quote.companyName,
        createdAt: new Date().toISOString(),
      });
    }

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

  private async notifyStakeholdersOnQuoteCreated(
    quote: IQuote,
  ): Promise<IQuote> {
    let finalQuote = quote;

    try {
      finalQuote = await this.notifyAdmin(quote);
    } catch (error) {
      logger.warn(
        { quoteId: quote._id.toString(), error },
        "Admin notification failed",
      );
    }

    if (this.shouldSendClientBookingConfirmation(quote)) {
      try {
        await this.emailService.sendClientBookingConfirmation({
          to: quote.email.toLowerCase(),
          clientName: this.resolveContactName(quote),
          bookingId: quote._id.toString(),
          serviceType: this.serviceTypeLabel(quote.serviceType),
          serviceDate: quote.serviceDate,
          preferredTime: formatTimeTo12Hour(quote.preferredTime),
          companyName: quote.companyName,
          businessAddress: quote.businessAddress,
        });
      } catch (error) {
        logger.warn(
          { quoteId: quote._id.toString(), clientEmail: quote.email, error },
          "Client booking confirmation email failed",
        );
      }
    }

    return finalQuote;
  }

  private shouldSendClientBookingConfirmation(quote: IQuote): boolean {
    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      return true;
    }

    const createdByRole = (quote.createdByRole || "").toLowerCase();
    return createdByRole === ROLES.CLIENT || createdByRole === "guest";
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
      status === QUOTE.STATUSES.CONTACTED ||
      status === QUOTE.STATUSES.CLOSED
    );
  }

  private normalizeCleaningFrequency(value?: string): string {
    const normalized = (value || "")
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-");

    if (
      normalized === "daily" ||
      normalized === "weekly" ||
      normalized === "monthly"
    ) {
      return normalized;
    }

    return "one-time";
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
    const derived = this.deriveStatuses(quote);
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const status =
      quote.status ||
      (quote.paymentStatus === "paid" ? QUOTE.STATUSES.PAID : undefined);
    const paymentStatus = this.isManualServiceType(serviceType)
      ? quote.paymentStatus === "paid"
        ? "paid"
        : "manual"
      : quote.paymentStatus;
    const cleaningStatus =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING
        : undefined;
    const reportStatus =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.reportStatus
        : undefined;
    const reportSubmittedBy =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.reportSubmittedBy?.toString()
        : undefined;
    const reportSubmittedAt =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? quote.reportSubmittedAt
        : undefined;
    const cleanerSharePercentage =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? (quote.cleanerSharePercentage ?? quote.cleanerPercentage)
        : undefined;
    const cleanerPercentage =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? (quote.cleanerPercentage ??
          (cleanerSharePercentage !== undefined &&
          cleanerSharePercentage !== null
            ? Number(
                (
                  cleanerSharePercentage /
                  Math.max(
                    quote.assignedCleanerIds?.length ||
                      0 ||
                      (quote.assignedCleanerId ? 1 : 0),
                    1,
                  )
                ).toFixed(4),
              )
            : undefined))
        : undefined;
    const cleanerEarningAmount = quote.cleanerEarningAmount;

    return {
      _id: quote._id.toString(),
      userId: quote.userId?.toString(),
      createdByRole: quote.createdByRole,
      serviceType,
      status,
      clientStatus: derived.clientStatus,
      cleanerStatus: derived.cleanerStatus,
      adminStatus: derived.adminStatus,
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
      paymentStatus,
      paidAt: quote.paidAt,
      adminNotifiedAt: quote.adminNotifiedAt,
      assignedCleanerId: quote.assignedCleanerId?.toString(),
      assignedCleanerIds: quote.assignedCleanerIds?.map((id) => id.toString()),
      assignedCleanerAt: quote.assignedCleanerAt,
      cleaningStatus,
      reportStatus,
      reportSubmittedBy,
      reportSubmittedAt,
      cleanerSharePercentage,
      cleanerPercentage,
      cleanerEarningAmount,
      cleaningFrequency: quote.cleaningFrequency,
      squareFoot: quote.squareFoot,
      cleaningServices: quote.cleaningServices,
      generalContractorName: quote.generalContractorName,
      generalContractorPhone: quote.generalContractorPhone,
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

  private deriveStatuses(quote: IQuote): {
    clientStatus: string;
    cleanerStatus: string;
    adminStatus: string;
  } {
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const isManualService = this.isManualServiceType(serviceType);
    const hasCleaner =
      Boolean(quote.assignedCleanerId) ||
      Boolean(quote.assignedCleanerIds && quote.assignedCleanerIds.length);
    const cleaning = quote.cleaningStatus;
    const report = quote.reportStatus;
    const completedStatuses = new Set<string>([
      QUOTE.STATUSES.COMPLETED,
      QUOTE.STATUSES.REVIEWED,
    ]);
    const isClosed = quote.status === QUOTE.STATUSES.CLOSED;
    const isCompleted =
      report === QUOTE.REPORT_STATUSES.APPROVED ||
      (quote.status ? completedStatuses.has(quote.status) : false);

    // Client view
    const clientStatus = (() => {
      if (isClosed) return isManualService ? "completed" : "closed";
      if (isCompleted) return "completed";
      if (
        report === QUOTE.REPORT_STATUSES.PENDING &&
        cleaning === QUOTE.CLEANING_STATUSES.COMPLETED
      )
        return "report_submitted";
      if (cleaning === QUOTE.CLEANING_STATUSES.IN_PROGRESS) return "ongoing";
      if (hasCleaner) return "assigned";
      return "booked";
    })();

    // Cleaner view
    const cleanerStatus = (() => {
      if (isClosed) return isManualService ? "completed" : "closed";
      if (isCompleted) return "completed";
      if (
        report === QUOTE.REPORT_STATUSES.PENDING &&
        cleaning === QUOTE.CLEANING_STATUSES.COMPLETED
      )
        return "waiting-for-admin-approval";
      if (cleaning === QUOTE.CLEANING_STATUSES.IN_PROGRESS) return "ongoing";
      if (hasCleaner) return "pending"; // assigned to cleaner but not started
      return "pending";
    })();

    // Admin view
    const adminStatus = (() => {
      if (isClosed) return "closed";
      if (isCompleted) return "completed";
      if (
        report === QUOTE.REPORT_STATUSES.PENDING &&
        cleaning === QUOTE.CLEANING_STATUSES.COMPLETED
      )
        return "report_submitted";
      if (cleaning === QUOTE.CLEANING_STATUSES.IN_PROGRESS) return "on_site";
      if (hasCleaner) return "assigned";
      return "pending";
    })();

    return { clientStatus, cleanerStatus, adminStatus };
  }
}
