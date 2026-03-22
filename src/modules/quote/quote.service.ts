import { QUOTE, ROLES } from "@/constants/app.constants";
import { logger } from "@/middlewares/pino-logger";
import { EmailService } from "@/services/email.service";
import { realtimeService } from "@/services/realtime.service";
import { stripeService } from "@/services/stripe.service";
import type { PaginateResult } from "@/ts/pagination.types";
import {
  BadRequestException,
  ConflictException,
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
import type {
  IQuote,
  IQuoteCleanerOccurrenceProgress,
  IQuoteCleanerProgress,
} from "./quote.interface";
import { QuotePricingService } from "./quote.pricing";
import { QuoteRepository } from "./quote.repository";
import { formatTimeTo12Hour, normalizeTimeTo24Hour } from "@/utils/time.utils";
import type {
  AdminQuoteNotificationListResponse,
  AdminQuoteNotificationResponse,
  QuoteCleanerOccurrenceProgressResponse,
  QuoteCleanerProgressResponse,
  QuoteCleanerProgressSummary,
  QuoteOccurrenceProgressSummary,
  QuoteAssignCleanerPayload,
  QuoteCreatePayload,
  QuotePaymentIntentResponse,
  QuotePaymentStatusResponse,
  QuoteRequestPayload,
  QuoteResponse,
  QuoteStatusUpdatePayload,
} from "./quote.type";
import type { IQuoteNotification } from "./quote-notification.interface";
import type {
  QuoteCleaningSchedule,
  QuoteCleaningScheduleMonthlySpecificDates,
  QuoteCleaningScheduleMonthlyWeekdayPattern,
  QuoteCleaningScheduleOneTime,
  QuoteCleaningScheduleWeekly,
  QuoteScheduleMonthWeek,
  QuoteScheduleWeekday,
} from "./quote-schedule.type";
import { QUOTE_SCHEDULE_MONTHS, QUOTE_SCHEDULE_WEEKDAYS } from "./quote-schedule.type";

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

const SCHEDULE_WEEKDAY_TO_INDEX: Record<QuoteScheduleWeekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const MONTH_DAY_LIMITS: Record<number, number> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
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
    const cleaningSchedule = this.normalizeCleaningSchedule(
      payload.cleaningSchedule,
    );
    const resolvedPrimarySchedule = this.resolvePrimarySchedule(
      cleaningSchedule,
      payload.preferredDate,
      payload.preferredTime,
    );
    const cleaningFrequency = this.normalizeCleaningFrequency(
      cleaningSchedule?.frequency,
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
    const requestedAssignedCleanerIds = this.normalizeCleanerIds(
      payload.assignedCleanerIds || [],
    );
    const normalizedCreatorRole = (createdByRole || "").toLowerCase();
    const canAssignCleanersOnCreate =
      normalizedCreatorRole === ROLES.ADMIN ||
      normalizedCreatorRole === ROLES.SUPER_ADMIN;

    if (requestedAssignedCleanerIds.length > 0 && !canAssignCleanersOnCreate) {
      throw new ForbiddenException(
        "Only admins can assign cleaners during request creation",
      );
    }

    const assignedCleaners =
      requestedAssignedCleanerIds.length > 0
        ? await this.resolveCleanerUsers(requestedAssignedCleanerIds)
        : [];
    const assignedCleanerIds = assignedCleaners.map((cleaner) =>
      cleaner._id.toString(),
    );
    const cleanerSharePercentage =
      Number.isFinite(totalPrice) &&
      Number.isFinite(cleanerPrice) &&
      Number(totalPrice) > 0 &&
      Number(cleanerPrice) >= 0
        ? Number(((Number(cleanerPrice) / Number(totalPrice)) * 100).toFixed(4))
        : undefined;
    const cleanerPercentage =
      cleanerSharePercentage !== undefined && assignedCleanerIds.length > 0
        ? Number((cleanerSharePercentage / assignedCleanerIds.length).toFixed(4))
        : cleanerSharePercentage;

    if (
      cleaningSchedule?.frequency === "weekly" &&
      assignedCleanerIds.length > 0 &&
      !cleaningSchedule.repeat_until
    ) {
      throw new BadRequestException(
        "Weekly bookings with assigned cleaners must include a repeat-until date",
      );
    }

    if (assignedCleanerIds.length > 0) {
      await this.assertCleanersAvailableForServiceDate(
        assignedCleanerIds,
        resolvedPrimarySchedule.serviceDate,
      );
    }

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
      serviceDate: resolvedPrimarySchedule.serviceDate,
      preferredTime: resolvedPrimarySchedule.preferredTime,
      notes,
      totalPrice: Number.isFinite(totalPrice) ? totalPrice : undefined,
      cleanerEarningAmount: Number.isFinite(cleanerPrice)
        ? cleanerPrice
        : undefined,
      cleanerSharePercentage,
      cleanerPercentage,
      cleaningFrequency,
      cleaningSchedule,
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

    const quoteWithProgress =
      assignedCleanerIds.length > 0
        ? (await this.quoteRepository.updateById(
            quote._id.toString(),
            this.buildManualOccurrenceProgressInitializationUpdate(
              quote,
              assignedCleanerIds,
            ),
          )) || quote
        : quote;

    const finalQuote = await this.notifyStakeholdersOnQuoteCreated(
      quoteWithProgress,
    );

    if (assignedCleaners.length > 0) {
      try {
        await this.notifyOnCleanerAssignmentChange({
          quote: finalQuote,
          quoteId: finalQuote._id.toString(),
          cleaners: assignedCleaners,
          assignmentType: "assigned",
          notifyClient: false,
        });
      } catch (error) {
        logger.warn(
          { quoteId: finalQuote._id.toString(), cleanerIds: assignedCleanerIds, error },
          "Cleaner assignment notification on create failed",
        );
      }
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

    const shouldNotifyCleanerOnClose =
      payload.status === QUOTE.STATUSES.CLOSED &&
      quote.status !== QUOTE.STATUSES.CLOSED;
    const shouldNotifyAdminOnCompletion = shouldNotifyCleanerOnClose;

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

    if (shouldNotifyAdminOnCompletion) {
      try {
        await this.notifyAdminBookingCompleted(updated, {
          eventKey: "status_closed",
        });
      } catch (error) {
        logger.warn(
          { quoteId: updated._id.toString(), error },
          "Admin completion notification failed",
        );
      }
    }

    return this.toResponse(updated);
  }

  async listAdminNotifications(params: {
    page?: number;
    limit?: number;
    onlyUnread?: boolean;
  }): Promise<AdminQuoteNotificationListResponse> {
    const page = Number(params.page) > 0 ? Number(params.page) : 1;
    const limit = Number(params.limit) > 0 ? Number(params.limit) : 20;

    const result = await this.notificationRepository.listAdminNotifications({
      page,
      limit,
      onlyUnread: Boolean(params.onlyUnread),
    });

    return {
      ...result,
      items: result.items.map((item) => this.toAdminNotificationResponse(item)),
    };
  }

  async markAdminNotificationAsRead(
    notificationId: string,
  ): Promise<AdminQuoteNotificationResponse> {
    const updated = await this.notificationRepository.markAsRead(notificationId);
    if (!updated) {
      throw new NotFoundException("Notification not found");
    }

    return this.toAdminNotificationResponse(updated);
  }

  async markAllAdminNotificationsAsRead(): Promise<{ modifiedCount: number }> {
    const modifiedCount = await this.notificationRepository.markAllAsRead();
    return { modifiedCount };
  }

  async notifyAdminReportSubmitted(
    quote: IQuote,
    payload: {
      reportId: string;
      occurrenceDate: string;
      submittedBy?: string;
      submittedAt?: Date;
    },
  ): Promise<void> {
    const clientName = this.resolveContactName(quote);
    const requestedServices = this.resolveRequestedServices(quote);
    const preferredTime = formatTimeTo12Hour(quote.preferredTime);
    const serviceTypeLabel = this.serviceTypeLabel(quote.serviceType);
    const submittedAt = payload.submittedAt || new Date();

    await this.notificationRepository.createOnce({
      quoteId: quote._id.toString(),
      event: "report_submitted",
      eventKey: payload.reportId,
      title: "Job report submitted",
      message: `A cleaner submitted a report for ${serviceTypeLabel} booking #${quote._id.toString()} on ${payload.occurrenceDate}.`,
      serviceType: quote.serviceType,
      clientName,
      companyName: quote.companyName,
      email: quote.email,
      phoneNumber: quote.phoneNumber,
      businessAddress: quote.businessAddress,
      serviceDate: payload.occurrenceDate || quote.serviceDate,
      preferredTime,
      requestedServices,
      notes: quote.notes,
    });

    realtimeService.emitAdminReportSubmitted({
      quoteId: quote._id.toString(),
      reportId: payload.reportId,
      serviceType: serviceTypeLabel,
      clientName,
      serviceDate: payload.occurrenceDate || quote.serviceDate,
      preferredTime,
      submittedBy: payload.submittedBy,
      submittedAt: submittedAt.toISOString(),
    });
  }

  async notifyAdminBookingCompleted(
    quote: IQuote,
    payload?: { eventKey?: string; completedAt?: Date; status?: string },
  ): Promise<void> {
    const clientName = this.resolveContactName(quote);
    const requestedServices = this.resolveRequestedServices(quote);
    const preferredTime = formatTimeTo12Hour(quote.preferredTime);
    const serviceTypeLabel = this.serviceTypeLabel(quote.serviceType);
    const completedAt = payload?.completedAt || new Date();

    await this.notificationRepository.createOnce({
      quoteId: quote._id.toString(),
      event: "booking_completed",
      eventKey: payload?.eventKey || "completed",
      title: "Booking completed",
      message: `${serviceTypeLabel} booking #${quote._id.toString()} for ${clientName} is marked as completed.`,
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

    realtimeService.emitAdminBookingCompleted({
      quoteId: quote._id.toString(),
      serviceType: serviceTypeLabel,
      clientName,
      serviceDate: quote.serviceDate,
      preferredTime,
      status: payload?.status || quote.status,
      completedAt: completedAt.toISOString(),
    });
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

    const uniqueCleanerIds = this.normalizeCleanerIds(cleanerIds);
    if (uniqueCleanerIds.length === 0) {
      throw new BadRequestException("Cleaner id is required");
    }
    const assignmentChanged = !this.haveSameIdSet(
      previousCleanerIds,
      uniqueCleanerIds,
    );
    const cleaners = await this.resolveCleanerUsers(uniqueCleanerIds);

    await this.assertCleanersAvailableForServiceDate(
      uniqueCleanerIds,
      quote.serviceDate,
      quoteId,
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
      if (this.isManualServiceType(serviceType)) {
        const derivedSharePercentage =
          this.asFiniteNumber(quote.cleanerSharePercentage) ??
          (this.resolveQuoteTotal(quote) > 0
            ? Number(
                (
                  (this.resolveManualCleanerPoolAmount(quote) /
                    this.resolveQuoteTotal(quote)) *
                  100
                ).toFixed(4),
              )
            : undefined);
        cleanerSharePercentage =
          derivedSharePercentage ?? primaryCleaner.cleanerPercentage;
      } else {
        if (cleanerCount > 1) {
          throw new BadRequestException(
            "cleanerSharePercentage is required when assigning multiple cleaners",
          );
        }
        cleanerSharePercentage = primaryCleaner.cleanerPercentage;
      }
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

    const updatePayload =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? this.buildResidentialAssignmentUpdate(
            quote,
            cleaners.map((cleaner) => cleaner._id.toString()),
            cleanerSharePercentage,
          )
        : {
            assignedCleanerId: primaryCleaner._id,
            assignedCleanerIds: cleaners.map((c) => c._id),
            assignedCleanerAt: new Date(),
            cleanerSharePercentage,
            cleanerPercentage: perCleanerPercentage,
            ...this.buildManualOccurrenceProgressInitializationUpdate(
              {
                ...quote,
                assignedCleanerId: primaryCleaner._id,
                assignedCleanerIds: cleaners.map((c) => c._id),
                cleanerSharePercentage,
                cleanerPercentage: perCleanerPercentage,
              } as IQuote,
              cleaners.map((cleaner) => cleaner._id.toString()),
            ),
          };

    const updated = await this.quoteRepository.updateById(quoteId, updatePayload);

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

  getOccurrenceDatesForQuote(
    quote: Pick<IQuote, "serviceType" | "serviceDate" | "cleaningSchedule">,
  ): string[] {
    const fallbackDate = quote.serviceDate?.trim();
    if (!fallbackDate) {
      return [];
    }

    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      return [fallbackDate];
    }

    const schedule = quote.cleaningSchedule as QuoteCleaningSchedule | undefined;
    if (!schedule || typeof schedule !== "object" || !("frequency" in schedule)) {
      return [fallbackDate];
    }

    if (schedule.frequency === "one_time") {
      return [schedule.schedule?.date?.trim() || fallbackDate];
    }

    const baseDate = this.parseDateOnly(fallbackDate, "Quote service date");

    if (schedule.frequency === "weekly") {
      if (!schedule.repeat_until?.trim()) {
        return [fallbackDate];
      }

      const repeatUntil = this.parseDateOnly(
        schedule.repeat_until,
        "Repeat until date",
      );
      const selectedDays = new Set<QuoteScheduleWeekday>(
        (Array.isArray(schedule.days) ? schedule.days : [])
          .map((day) => String(day || "").trim().toLowerCase() as QuoteScheduleWeekday)
          .filter((day) => day in SCHEDULE_WEEKDAY_TO_INDEX),
      );

      if (!selectedDays.size) {
        return [fallbackDate];
      }

      const dates: string[] = [];
      let cursor = this.startOfDay(baseDate);
      const end = this.startOfDay(repeatUntil);

      while (cursor <= end) {
        const weekday = this.weekdayFromDate(cursor);
        if (selectedDays.has(weekday)) {
          dates.push(this.toDateString(cursor));
        }
        cursor = this.addDays(cursor, 1);
      }

      return Array.from(new Set(dates)).sort((a, b) => (a > b ? 1 : -1));
    }

    const scheduleYear =
      "year" in schedule && typeof schedule.year === "number"
        ? schedule.year
        : baseDate.getFullYear();

    if (
      schedule.frequency === "monthly" &&
      schedule.pattern_type === "specific_dates"
    ) {
      const monthDatesMap = this.resolveMonthlyDatesMap(schedule);
      const months = this.normalizeScheduleMonths(schedule.months);
      const dates: string[] = [];

      months.forEach((monthValue) => {
        const days = monthDatesMap.get(monthValue) || [];
        days.forEach((day) => {
          const candidate = new Date(scheduleYear, monthValue - 1, day);
          if (
            candidate.getFullYear() === scheduleYear &&
            candidate.getMonth() === monthValue - 1 &&
            this.startOfDay(candidate) >= this.startOfDay(baseDate)
          ) {
            dates.push(this.toDateString(candidate));
          }
        });
      });

      return Array.from(new Set(dates)).sort((a, b) => (a > b ? 1 : -1));
    }

    if (
      schedule.frequency === "monthly" &&
      schedule.pattern_type === "weekday_pattern"
    ) {
      const months = this.normalizeScheduleMonths(schedule.months);
      const week = String(schedule.week || "").trim().toLowerCase() as QuoteScheduleMonthWeek;
      const day = String(schedule.day || "").trim().toLowerCase() as QuoteScheduleWeekday;
      const dates: string[] = [];

      months.forEach((monthValue) => {
        const dayOfMonth = this.getWeekdayPatternDayOfMonth(
          scheduleYear,
          monthValue - 1,
          week,
          day,
        );

        if (!dayOfMonth) {
          return;
        }

        const candidate = new Date(scheduleYear, monthValue - 1, dayOfMonth);
        if (
          candidate.getFullYear() === scheduleYear &&
          candidate.getMonth() === monthValue - 1 &&
          this.startOfDay(candidate) >= this.startOfDay(baseDate)
        ) {
          dates.push(this.toDateString(candidate));
        }
      });

      return Array.from(new Set(dates)).sort((a, b) => (a > b ? 1 : -1));
    }

    return [fallbackDate];
  }

  getCleanerOccurrenceProgress(
    quote: IQuote,
  ): IQuoteCleanerOccurrenceProgress[] {
    const existingOccurrenceProgress = Array.isArray(quote.cleanerOccurrenceProgress)
      ? quote.cleanerOccurrenceProgress
      : [];

    if (existingOccurrenceProgress.length) {
      return existingOccurrenceProgress
        .filter((entry) => entry?.cleanerId && entry?.occurrenceDate)
        .map((entry) => ({
          ...entry,
          occurrenceDate: entry.occurrenceDate.trim(),
          cleaningStatus:
            entry.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING,
          paymentStatus:
            entry.paymentStatus ||
            (entry.reportStatus === QUOTE.REPORT_STATUSES.APPROVED
              ? "paid"
              : "pending"),
        }));
    }

    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      return this.getResidentialCleanerProgress(quote).map((entry) => ({
        ...entry,
        occurrenceDate: quote.serviceDate,
      }));
    }

    return [];
  }

  private resolveManualCleanerPoolAmount(quote: IQuote): number {
    const directAmount = this.asFiniteNumber(quote.cleanerEarningAmount);
    if (directAmount !== undefined) {
      return Number(directAmount.toFixed(2));
    }

    const totalPrice = this.resolveQuoteTotal(quote);
    const sharePercentage = this.asFiniteNumber(quote.cleanerSharePercentage);
    if (
      totalPrice > 0 &&
      sharePercentage !== undefined &&
      sharePercentage > 0
    ) {
      return Number(((totalPrice * sharePercentage) / 100).toFixed(2));
    }

    return 0;
  }

  private toCents(amount?: number): number {
    return Math.round((this.asFiniteNumber(amount) || 0) * 100);
  }

  private fromCents(amountCents: number): number {
    return Number((amountCents / 100).toFixed(2));
  }

  private splitCentsEvenly(totalCents: number, count: number): number[] {
    if (count <= 0) {
      return [];
    }

    const base = Math.floor(totalCents / count);
    const remainder = totalCents - base * count;

    return Array.from({ length: count }, (_, index) =>
      base + (index < remainder ? 1 : 0),
    );
  }

  private buildManualOccurrenceProgressEntries(
    quote: IQuote,
    cleanerIds?: string[],
    existingEntries?: IQuoteCleanerOccurrenceProgress[],
  ): IQuoteCleanerOccurrenceProgress[] {
    const assignedCleanerIds = this.normalizeCleanerIds(
      cleanerIds || this.extractAssignedCleanerIds(quote),
    );
    const occurrenceDates = this.getOccurrenceDatesForQuote(quote);

    if (!assignedCleanerIds.length || !occurrenceDates.length) {
      return [];
    }

    const cleanerCount = Math.max(assignedCleanerIds.length, 1);
    const occurrenceCount = Math.max(occurrenceDates.length, 1);
    const totalCleanerPool = this.resolveManualCleanerPoolAmount(quote);
    const totalPrice = this.resolveQuoteTotal(quote);
    const perCleanerTotalCents = this.splitCentsEvenly(
      this.toCents(totalCleanerPool),
      cleanerCount,
    );
    const existingMap = new Map(
      (existingEntries || []).map((entry) => [
        `${entry.cleanerId.toString()}:${entry.occurrenceDate}`,
        entry,
      ]),
    );

    return assignedCleanerIds.flatMap((cleanerId, cleanerIndex) => {
      const cleanerTotalAmount = this.fromCents(
        perCleanerTotalCents[cleanerIndex] || 0,
      );
      const perOccurrenceCents = this.splitCentsEvenly(
        perCleanerTotalCents[cleanerIndex] || 0,
        occurrenceCount,
      );
      const cleanerPercentage =
        totalPrice > 0 && cleanerTotalAmount > 0
          ? Number(((cleanerTotalAmount / totalPrice) * 100).toFixed(4))
          : this.asFiniteNumber(quote.cleanerPercentage);

      return occurrenceDates.map((occurrenceDate, occurrenceIndex) => {
        const current = existingMap.get(`${cleanerId}:${occurrenceDate}`);
        const occurrenceAmount = this.fromCents(
          perOccurrenceCents[occurrenceIndex] || 0,
        );
        const occurrencePercentage =
          totalPrice > 0 && occurrenceAmount > 0
            ? Number(((occurrenceAmount / totalPrice) * 100).toFixed(4))
            : cleanerPercentage;

        return {
          cleanerId,
          occurrenceDate,
          cleaningStatus:
            current?.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING,
          reportStatus: current?.reportStatus,
          reportId: current?.reportId,
          reportSubmittedAt: current?.reportSubmittedAt,
          reportApprovedAt: current?.reportApprovedAt,
          arrivalMarkedAt: current?.arrivalMarkedAt,
          paymentStatus:
            current?.paymentStatus ||
            (current?.reportStatus === QUOTE.REPORT_STATUSES.APPROVED
              ? "paid"
              : "pending"),
          paidAt: current?.paidAt,
          cleanerPercentage:
            this.asFiniteNumber(current?.cleanerPercentage) ??
            occurrencePercentage,
          cleanerEarningAmount:
            this.asFiniteNumber(current?.cleanerEarningAmount) ??
            occurrenceAmount,
        } as IQuoteCleanerOccurrenceProgress;
      });
    });
  }

  private getNormalizedCleanerProgress(quote: IQuote): IQuoteCleanerProgress[] {
    if (quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      return this.getResidentialCleanerProgress(quote);
    }

    const occurrenceProgress = this.getCleanerOccurrenceProgress(quote);
    if (occurrenceProgress.length > 0) {
      return this.buildCleanerProgressFromOccurrences(quote, occurrenceProgress);
    }

    return Array.isArray(quote.cleanerProgress) ? quote.cleanerProgress : [];
  }

  getResidentialCleanerProgress(quote: IQuote): IQuoteCleanerProgress[] {
    const assignedCleanerIds = this.extractAssignedCleanerIds(quote);
    const existingProgress = Array.isArray(quote.cleanerProgress)
      ? quote.cleanerProgress
      : [];
    const existingIds = existingProgress
      .map((entry) => entry?.cleanerId?.toString())
      .filter((id): id is string => Boolean(id));
    const cleanerIds = Array.from(
      new Set(
        (assignedCleanerIds.length ? assignedCleanerIds : existingIds).concat(
          existingIds,
        ),
      ),
    );

    if (!cleanerIds.length) {
      return [];
    }

    const cleanerCount = cleanerIds.length;
    const totalSharePct = this.asFiniteNumber(quote.cleanerSharePercentage);
    const fallbackCleanerPct =
      this.asFiniteNumber(quote.cleanerPercentage) ??
      (totalSharePct !== undefined
        ? Number((totalSharePct / Math.max(cleanerCount, 1)).toFixed(4))
        : undefined);
    const fallbackCleanerAmount = this.resolveResidentialCleanerAmount(
      quote,
      fallbackCleanerPct,
    );
    const progressMap = new Map(
      existingProgress
        .filter((entry) => entry?.cleanerId)
        .map((entry) => [entry.cleanerId.toString(), entry]),
    );
    const legacySubmittedBy = quote.reportSubmittedBy?.toString();
    const legacyIsApproved =
      quote.reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
      quote.status === QUOTE.STATUSES.COMPLETED ||
      quote.status === QUOTE.STATUSES.REVIEWED;
    const legacyIsPending =
      quote.reportStatus === QUOTE.REPORT_STATUSES.PENDING ||
      quote.cleaningStatus === QUOTE.CLEANING_STATUSES.COMPLETED;
    const legacyInProgress =
      quote.cleaningStatus === QUOTE.CLEANING_STATUSES.IN_PROGRESS;
    const legacyInProgressCleanerId =
      cleanerIds.length === 1 ? cleanerIds[0] : quote.assignedCleanerId?.toString();

    return cleanerIds.map((cleanerId) => {
      const current = progressMap.get(cleanerId);
      if (current) {
        return {
          cleanerId,
          cleaningStatus:
            current.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING,
          reportStatus: current.reportStatus,
          reportId: current.reportId,
          reportSubmittedAt: current.reportSubmittedAt,
          reportApprovedAt: current.reportApprovedAt,
          arrivalMarkedAt: current.arrivalMarkedAt,
          paymentStatus:
            current.paymentStatus ||
            (current.reportStatus === QUOTE.REPORT_STATUSES.APPROVED
              ? "paid"
              : "pending"),
          paidAt: current.paidAt,
          cleanerPercentage:
            this.asFiniteNumber(current.cleanerPercentage) ??
            fallbackCleanerPct,
          cleanerEarningAmount:
            this.asFiniteNumber(current.cleanerEarningAmount) ??
            fallbackCleanerAmount,
        };
      }

      const legacyEntry: IQuoteCleanerProgress = {
        cleanerId,
        cleaningStatus: QUOTE.CLEANING_STATUSES.PENDING,
        paymentStatus: "pending",
        cleanerPercentage: fallbackCleanerPct,
        cleanerEarningAmount: fallbackCleanerAmount,
      };

      if (legacyIsApproved) {
        legacyEntry.cleaningStatus = QUOTE.CLEANING_STATUSES.COMPLETED;
        legacyEntry.reportStatus = QUOTE.REPORT_STATUSES.APPROVED;
        legacyEntry.reportSubmittedAt = quote.reportSubmittedAt || quote.updatedAt;
        legacyEntry.reportApprovedAt = quote.updatedAt || quote.paidAt;
        legacyEntry.paymentStatus = "paid";
        legacyEntry.paidAt = quote.updatedAt || quote.paidAt;
      } else if (legacyIsPending) {
        const shouldMarkSubmitted =
          cleanerIds.length === 1 ||
          !legacySubmittedBy ||
          legacySubmittedBy === cleanerId;
        if (shouldMarkSubmitted) {
          legacyEntry.cleaningStatus = QUOTE.CLEANING_STATUSES.COMPLETED;
          legacyEntry.reportStatus = QUOTE.REPORT_STATUSES.PENDING;
          legacyEntry.reportSubmittedAt = quote.reportSubmittedAt || quote.updatedAt;
        }
      } else if (
        legacyInProgress &&
        legacyInProgressCleanerId &&
        legacyInProgressCleanerId === cleanerId
      ) {
        legacyEntry.cleaningStatus = QUOTE.CLEANING_STATUSES.IN_PROGRESS;
        legacyEntry.arrivalMarkedAt = quote.updatedAt;
      }

      return legacyEntry;
    });
  }

  buildResidentialAssignmentUpdate(
    quote: IQuote,
    cleanerIds: string[],
    cleanerSharePercentage: number,
  ): Partial<IQuote> {
    const uniqueCleanerIds = this.normalizeCleanerIds(cleanerIds);
    const perCleanerPercentage =
      uniqueCleanerIds.length > 0
        ? Number((cleanerSharePercentage / uniqueCleanerIds.length).toFixed(4))
        : cleanerSharePercentage;
    const perCleanerAmount = this.resolveResidentialCleanerAmount(
      quote,
      perCleanerPercentage,
    );
    const existingProgress = this.getResidentialCleanerProgress(quote);
    const existingMap = new Map(
      existingProgress.map((entry) => [entry.cleanerId.toString(), entry]),
    );
    const cleanerProgress = uniqueCleanerIds.map((cleanerId) => {
      const current = existingMap.get(cleanerId);
      return {
        cleanerId,
        cleaningStatus:
          current?.cleaningStatus || QUOTE.CLEANING_STATUSES.PENDING,
        reportStatus: current?.reportStatus,
        reportId: current?.reportId,
        reportSubmittedAt: current?.reportSubmittedAt,
        reportApprovedAt: current?.reportApprovedAt,
        arrivalMarkedAt: current?.arrivalMarkedAt,
        paymentStatus:
          current?.paymentStatus ||
          (current?.reportStatus === QUOTE.REPORT_STATUSES.APPROVED
            ? "paid"
            : "pending"),
        paidAt: current?.paidAt,
        cleanerPercentage: perCleanerPercentage,
        cleanerEarningAmount: perCleanerAmount,
      } satisfies IQuoteCleanerProgress;
    });

    return {
      assignedCleanerId: uniqueCleanerIds[0] as any,
      assignedCleanerIds: uniqueCleanerIds as any,
      assignedCleanerAt: uniqueCleanerIds.length ? new Date() : undefined,
      cleanerSharePercentage,
      cleanerPercentage: perCleanerPercentage,
      cleanerEarningAmount: perCleanerAmount,
      ...this.buildResidentialAggregateUpdateFromProgress(quote, cleanerProgress),
    };
  }

  buildResidentialArrivalUpdate(
    quote: IQuote,
    cleanerId: string,
    arrivalMarkedAt: Date,
  ): Partial<IQuote> {
    const cleanerProgress = this.getResidentialCleanerProgress(quote).map(
      (entry) =>
        entry.cleanerId.toString() === cleanerId
          ? {
              ...entry,
              cleaningStatus: QUOTE.CLEANING_STATUSES.IN_PROGRESS,
              arrivalMarkedAt,
            }
          : entry,
    );

    return this.buildResidentialAggregateUpdateFromProgress(quote, cleanerProgress);
  }

  buildResidentialReportSubmissionUpdate(
    quote: IQuote,
    cleanerId: string,
    reportId: string,
    submittedAt: Date,
  ): Partial<IQuote> {
    const cleanerProgress = this.getResidentialCleanerProgress(quote).map(
      (entry) =>
        entry.cleanerId.toString() === cleanerId
          ? {
              ...entry,
              cleaningStatus: QUOTE.CLEANING_STATUSES.COMPLETED,
              reportStatus: QUOTE.REPORT_STATUSES.PENDING,
              reportId,
              reportSubmittedAt: submittedAt,
              paymentStatus: "pending" as const,
              paidAt: undefined,
            }
          : entry,
    );

    return this.buildResidentialAggregateUpdateFromProgress(quote, cleanerProgress);
  }

  buildResidentialReportApprovalUpdate(
    quote: IQuote,
    cleanerId: string,
    reportId: string,
    approvedAt: Date,
  ): Partial<IQuote> {
    const cleanerProgress = this.getResidentialCleanerProgress(quote).map(
      (entry) =>
        entry.cleanerId.toString() === cleanerId
          ? {
              ...entry,
              cleaningStatus: QUOTE.CLEANING_STATUSES.COMPLETED,
              reportStatus: QUOTE.REPORT_STATUSES.APPROVED,
              reportId,
              reportApprovedAt: approvedAt,
              paymentStatus: "paid" as const,
              paidAt: approvedAt,
            }
          : entry,
    );

    return this.buildResidentialAggregateUpdateFromProgress(quote, cleanerProgress);
  }

  resolveCleanerProgressForCleaner(
    quote: IQuote,
    cleanerId?: string,
  ): IQuoteCleanerProgress | undefined {
    if (!cleanerId) {
      return undefined;
    }

    return this.getNormalizedCleanerProgress(quote).find(
      (entry) => entry.cleanerId.toString() === cleanerId,
    );
  }

  toCleanerProgressResponse(
    quote: IQuote,
    progress: IQuoteCleanerProgress,
  ): QuoteCleanerProgressResponse {
    if (this.isManualServiceType(quote.serviceType || "")) {
      const occurrenceProgress = this.resolveOccurrenceProgressForCleaner(
        quote,
        progress.cleanerId.toString(),
      );
      const metrics = this.buildCleanerMetricsFromOccurrences(occurrenceProgress);
      const totalPrice = this.resolveQuoteTotal(quote);
      const totalAmount = Number(metrics.totalAmount.toFixed(2));
      const paidAmount = Number(metrics.paidAmount.toFixed(2));
      const pendingAmount = Number(Math.max(totalAmount - paidAmount, 0).toFixed(2));
      const cleanerPercentage =
        totalPrice > 0 && totalAmount > 0
          ? Number(((totalAmount / totalPrice) * 100).toFixed(4))
          : this.asFiniteNumber(progress.cleanerPercentage) ??
            this.asFiniteNumber(quote.cleanerPercentage);

      return {
        cleanerId: progress.cleanerId.toString(),
        cleaningStatus: progress.cleaningStatus,
        reportStatus: progress.reportStatus,
        cleanerStatus: this.deriveManualCleanerStatus(metrics),
        reportId: progress.reportId?.toString(),
        reportSubmittedAt: progress.reportSubmittedAt,
        reportApprovedAt: progress.reportApprovedAt,
        arrivalMarkedAt: progress.arrivalMarkedAt,
        paymentStatus: paidAmount > 0 && paidAmount === totalAmount ? "paid" : "pending",
        paidAt: progress.paidAt,
        cleanerPercentage,
        cleanerEarningAmount: totalAmount,
        occurrenceCount: metrics.totalOccurrences,
        approvedOccurrenceCount: metrics.completed,
        pendingOccurrenceCount:
          metrics.pending + metrics.inProgress + metrics.reportSubmitted,
        inProgressOccurrenceCount: metrics.inProgress,
        paidAmount,
        pendingAmount,
      };
    }

    return {
      cleanerId: progress.cleanerId.toString(),
      cleaningStatus: progress.cleaningStatus,
      reportStatus: progress.reportStatus,
      cleanerStatus: this.deriveCleanerProgressStatus(progress),
      reportId: progress.reportId?.toString(),
      reportSubmittedAt: progress.reportSubmittedAt,
      reportApprovedAt: progress.reportApprovedAt,
      arrivalMarkedAt: progress.arrivalMarkedAt,
      paymentStatus: progress.paymentStatus,
      paidAt: progress.paidAt,
      cleanerPercentage:
        this.asFiniteNumber(progress.cleanerPercentage) ??
        this.asFiniteNumber(quote.cleanerPercentage),
      cleanerEarningAmount:
        this.asFiniteNumber(progress.cleanerEarningAmount) ??
        this.resolveResidentialCleanerAmount(
          quote,
          this.asFiniteNumber(progress.cleanerPercentage) ??
            this.asFiniteNumber(quote.cleanerPercentage),
        ),
    };
  }

  buildCleanerProgressSummary(quote: IQuote): QuoteCleanerProgressSummary | undefined {
    const cleanerProgress = this.getNormalizedCleanerProgress(quote);
    if (!cleanerProgress.length) {
      return undefined;
    }

    return cleanerProgress.reduce<QuoteCleanerProgressSummary>(
      (acc, entry) => {
        const status = this.toCleanerProgressResponse(quote, entry).cleanerStatus;
        acc.totalAssigned += 1;
        if (status === "completed") {
          acc.completed += 1;
        } else if (status === "waiting-for-admin-approval") {
          acc.reportSubmitted += 1;
        } else if (status === "ongoing") {
          acc.inProgress += 1;
        } else {
          acc.pending += 1;
        }

        if (entry.paymentStatus === "paid") {
          acc.paid += 1;
        } else {
          acc.unpaid += 1;
        }

        return acc;
      },
      {
        totalAssigned: 0,
        pending: 0,
        inProgress: 0,
        reportSubmitted: 0,
        completed: 0,
        paid: 0,
        unpaid: 0,
      },
    );
  }

  private buildResidentialAggregateUpdateFromProgress(
    quote: IQuote,
    cleanerProgress: IQuoteCleanerProgress[],
  ): Partial<IQuote> {
    const summary = cleanerProgress.reduce(
      (acc, entry) => {
        const status = this.deriveCleanerProgressStatus(entry);
        if (status === "completed") {
          acc.completed += 1;
        } else if (status === "waiting-for-admin-approval") {
          acc.reportSubmitted += 1;
        } else if (status === "ongoing") {
          acc.inProgress += 1;
        } else {
          acc.pending += 1;
        }

        if (entry.reportSubmittedAt) {
          if (
            !acc.latestSubmittedAt ||
            entry.reportSubmittedAt > acc.latestSubmittedAt
          ) {
            acc.latestSubmittedAt = entry.reportSubmittedAt;
            acc.latestSubmittedBy = entry.cleanerId.toString();
          }
        }

        return acc;
      },
      {
        completed: 0,
        reportSubmitted: 0,
        inProgress: 0,
        pending: 0,
        latestSubmittedAt: undefined as Date | undefined,
        latestSubmittedBy: undefined as string | undefined,
      },
    );
    const totalAssigned = cleanerProgress.length;
    const allApproved = totalAssigned > 0 && summary.completed === totalAssigned;
    const anySubmitted = summary.completed > 0 || summary.reportSubmitted > 0;
    const hasStarted = anySubmitted || summary.inProgress > 0;
    const nextStatus = allApproved
      ? QUOTE.STATUSES.COMPLETED
      : quote.paymentStatus === "paid"
        ? QUOTE.STATUSES.PAID
        : quote.status === QUOTE.STATUSES.COMPLETED
          ? QUOTE.STATUSES.PAID
          : quote.status;

    return {
      cleanerProgress,
      cleanerPercentage:
        this.asFiniteNumber(cleanerProgress[0]?.cleanerPercentage) ??
        this.asFiniteNumber(quote.cleanerPercentage),
      cleanerEarningAmount:
        this.asFiniteNumber(cleanerProgress[0]?.cleanerEarningAmount) ??
        this.asFiniteNumber(quote.cleanerEarningAmount),
      cleaningStatus:
        totalAssigned === 0
          ? QUOTE.CLEANING_STATUSES.PENDING
          : allApproved
            ? QUOTE.CLEANING_STATUSES.COMPLETED
            : summary.inProgress > 0
              ? QUOTE.CLEANING_STATUSES.IN_PROGRESS
              : anySubmitted
                ? QUOTE.CLEANING_STATUSES.COMPLETED
                : QUOTE.CLEANING_STATUSES.PENDING,
      reportStatus:
        totalAssigned === 0 || !anySubmitted
          ? undefined
          : allApproved
            ? QUOTE.REPORT_STATUSES.APPROVED
            : QUOTE.REPORT_STATUSES.PENDING,
      reportSubmittedBy: summary.latestSubmittedBy as any,
      reportSubmittedAt: summary.latestSubmittedAt,
      status: hasStarted ? nextStatus : quote.status,
    };
  }

  buildManualOccurrenceProgressInitializationUpdate(
    quote: IQuote,
    cleanerIds?: string[],
  ): Partial<IQuote> {
    const occurrenceProgress = this.buildManualOccurrenceProgressEntries(
      quote,
      cleanerIds,
      this.getCleanerOccurrenceProgress(quote),
    );

    return this.buildManualAggregateUpdateFromOccurrenceProgress(
      quote,
      occurrenceProgress,
    );
  }

  buildManualOccurrenceArrivalUpdate(
    quote: IQuote,
    cleanerId: string,
    occurrenceDate: string,
    arrivalMarkedAt: Date,
  ): Partial<IQuote> {
    const occurrenceProgress = this.getCleanerOccurrenceProgress(quote).map((entry) =>
      entry.cleanerId.toString() === cleanerId &&
      entry.occurrenceDate === occurrenceDate
        ? {
            ...entry,
            cleaningStatus: QUOTE.CLEANING_STATUSES.IN_PROGRESS,
            arrivalMarkedAt,
          }
        : entry,
    );

    return this.buildManualAggregateUpdateFromOccurrenceProgress(
      quote,
      occurrenceProgress,
    );
  }

  buildManualReportSubmissionUpdate(
    quote: IQuote,
    cleanerId: string,
    occurrenceDate: string,
    reportId: string,
    submittedAt: Date,
  ): Partial<IQuote> {
    const occurrenceProgress = this.getCleanerOccurrenceProgress(quote).map((entry) =>
      entry.cleanerId.toString() === cleanerId &&
      entry.occurrenceDate === occurrenceDate
        ? {
            ...entry,
            cleaningStatus: QUOTE.CLEANING_STATUSES.COMPLETED,
            reportStatus: QUOTE.REPORT_STATUSES.PENDING,
            reportId,
            reportSubmittedAt: submittedAt,
            paymentStatus: "pending" as const,
            paidAt: undefined,
          }
        : entry,
    );

    return this.buildManualAggregateUpdateFromOccurrenceProgress(
      quote,
      occurrenceProgress,
    );
  }

  buildManualReportApprovalUpdate(
    quote: IQuote,
    cleanerId: string,
    occurrenceDate: string,
    reportId: string,
    approvedAt: Date,
  ): Partial<IQuote> {
    const occurrenceProgress = this.getCleanerOccurrenceProgress(quote).map((entry) =>
      entry.cleanerId.toString() === cleanerId &&
      entry.occurrenceDate === occurrenceDate
        ? {
            ...entry,
            cleaningStatus: QUOTE.CLEANING_STATUSES.COMPLETED,
            reportStatus: QUOTE.REPORT_STATUSES.APPROVED,
            reportId,
            reportApprovedAt: approvedAt,
            paymentStatus: "paid" as const,
            paidAt: approvedAt,
          }
        : entry,
    );

    return this.buildManualAggregateUpdateFromOccurrenceProgress(
      quote,
      occurrenceProgress,
    );
  }

  resolveOccurrenceProgressForCleaner(
    quote: IQuote,
    cleanerId?: string,
  ): IQuoteCleanerOccurrenceProgress[] {
    if (!cleanerId) {
      return [];
    }

    return this.getCleanerOccurrenceProgress(quote).filter(
      (entry) => entry.cleanerId.toString() === cleanerId,
    );
  }

  resolveOccurrenceProgressForCleanerAndDate(
    quote: IQuote,
    cleanerId?: string,
    occurrenceDate?: string,
  ): IQuoteCleanerOccurrenceProgress | undefined {
    if (!cleanerId || !occurrenceDate) {
      return undefined;
    }

    return this.getCleanerOccurrenceProgress(quote).find(
      (entry) =>
        entry.cleanerId.toString() === cleanerId &&
        entry.occurrenceDate === occurrenceDate,
    );
  }

  toOccurrenceProgressResponse(
    progress: IQuoteCleanerOccurrenceProgress,
  ): QuoteCleanerOccurrenceProgressResponse {
    return {
      cleanerId: progress.cleanerId.toString(),
      occurrenceDate: progress.occurrenceDate,
      cleaningStatus: progress.cleaningStatus,
      reportStatus: progress.reportStatus,
      cleanerStatus: this.deriveOccurrenceProgressStatus(progress),
      reportId: progress.reportId?.toString(),
      reportSubmittedAt: progress.reportSubmittedAt,
      reportApprovedAt: progress.reportApprovedAt,
      arrivalMarkedAt: progress.arrivalMarkedAt,
      paymentStatus: progress.paymentStatus,
      paidAt: progress.paidAt,
      cleanerPercentage: this.asFiniteNumber(progress.cleanerPercentage),
      cleanerEarningAmount: this.asFiniteNumber(progress.cleanerEarningAmount),
    };
  }

  buildOccurrenceProgressSummary(
    quote: IQuote,
  ): QuoteOccurrenceProgressSummary | undefined {
    const occurrenceProgress = this.getCleanerOccurrenceProgress(quote);
    if (!occurrenceProgress.length) {
      return undefined;
    }

    const totalOccurrences = new Set(
      occurrenceProgress.map((entry) => entry.occurrenceDate),
    ).size;

    return occurrenceProgress.reduce<QuoteOccurrenceProgressSummary>(
      (acc, entry) => {
        const status = this.deriveOccurrenceProgressStatus(entry);
        acc.totalAssignments += 1;
        if (status === "completed") {
          acc.completed += 1;
        } else if (status === "waiting-for-admin-approval") {
          acc.reportSubmitted += 1;
        } else if (status === "ongoing") {
          acc.inProgress += 1;
        } else {
          acc.pending += 1;
        }

        if (entry.paymentStatus === "paid") {
          acc.paid += 1;
        } else {
          acc.unpaid += 1;
        }

        return acc;
      },
      {
        totalAssignments: 0,
        pending: 0,
        inProgress: 0,
        reportSubmitted: 0,
        completed: 0,
        paid: 0,
        unpaid: 0,
        totalOccurrences,
      },
    );
  }

  private buildManualAggregateUpdateFromOccurrenceProgress(
    quote: IQuote,
    occurrenceProgress: IQuoteCleanerOccurrenceProgress[],
  ): Partial<IQuote> {
    const cleanerProgress = this.buildCleanerProgressFromOccurrences(
      quote,
      occurrenceProgress,
    );
    const occurrenceSummary = this.buildOccurrenceSummaryMetrics(occurrenceProgress);
    const allApproved =
      occurrenceSummary.totalAssignments > 0 &&
      occurrenceSummary.completed === occurrenceSummary.totalAssignments;
    const anySubmitted =
      occurrenceSummary.completed > 0 || occurrenceSummary.reportSubmitted > 0;

    return {
      cleanerOccurrenceProgress: occurrenceProgress,
      cleanerProgress,
      cleaningStatus:
        occurrenceSummary.totalAssignments === 0
          ? QUOTE.CLEANING_STATUSES.PENDING
          : allApproved
            ? QUOTE.CLEANING_STATUSES.COMPLETED
            : occurrenceSummary.inProgress > 0 || anySubmitted
              ? QUOTE.CLEANING_STATUSES.IN_PROGRESS
              : QUOTE.CLEANING_STATUSES.PENDING,
      reportStatus:
        occurrenceSummary.totalAssignments === 0 || !anySubmitted
          ? undefined
          : allApproved
            ? QUOTE.REPORT_STATUSES.APPROVED
            : QUOTE.REPORT_STATUSES.PENDING,
      reportSubmittedBy: occurrenceSummary.latestSubmittedBy as any,
      reportSubmittedAt: occurrenceSummary.latestSubmittedAt,
      status: allApproved ? QUOTE.STATUSES.COMPLETED : quote.status,
    };
  }

  private buildCleanerProgressFromOccurrences(
    quote: IQuote,
    occurrenceProgress: IQuoteCleanerOccurrenceProgress[],
  ): IQuoteCleanerProgress[] {
    const byCleaner = new Map<string, IQuoteCleanerOccurrenceProgress[]>();
    occurrenceProgress.forEach((entry) => {
      const cleanerId = entry.cleanerId.toString();
      const items = byCleaner.get(cleanerId) || [];
      items.push(entry);
      byCleaner.set(cleanerId, items);
    });

    return Array.from(byCleaner.entries()).map(([cleanerId, entries]) => {
      const metrics = this.buildCleanerMetricsFromOccurrences(entries);
      const firstEntry = entries[0];
      const totalPrice = this.resolveQuoteTotal(quote);
      const totalAmount = Number(metrics.totalAmount.toFixed(2));

      return {
        cleanerId,
        cleaningStatus:
          metrics.completed === metrics.totalOccurrences
            ? QUOTE.CLEANING_STATUSES.COMPLETED
            : metrics.reportSubmitted > 0 &&
                metrics.pending === 0 &&
                metrics.inProgress === 0
              ? QUOTE.CLEANING_STATUSES.COMPLETED
              : metrics.inProgress > 0 ||
                  metrics.reportSubmitted > 0 ||
                  metrics.completed > 0
              ? QUOTE.CLEANING_STATUSES.IN_PROGRESS
              : QUOTE.CLEANING_STATUSES.PENDING,
        reportStatus:
          metrics.totalOccurrences > 0 && metrics.completed === metrics.totalOccurrences
            ? QUOTE.REPORT_STATUSES.APPROVED
            : metrics.reportSubmitted > 0 || metrics.completed > 0
              ? QUOTE.REPORT_STATUSES.PENDING
              : undefined,
        reportSubmittedAt: metrics.latestSubmittedAt,
        reportApprovedAt: metrics.latestApprovedAt,
        arrivalMarkedAt: metrics.latestArrivalAt,
        paymentStatus:
          metrics.totalOccurrences > 0 && metrics.completed === metrics.totalOccurrences
            ? "paid"
            : "pending",
        paidAt:
          metrics.totalOccurrences > 0 && metrics.completed === metrics.totalOccurrences
            ? metrics.latestApprovedAt
            : undefined,
        cleanerPercentage:
          totalPrice > 0 && totalAmount > 0
            ? Number(((totalAmount / totalPrice) * 100).toFixed(4))
            : this.asFiniteNumber(firstEntry?.cleanerPercentage) ??
              this.asFiniteNumber(quote.cleanerPercentage),
        cleanerEarningAmount: totalAmount,
      };
    });
  }

  private buildCleanerMetricsFromOccurrences(
    occurrenceProgress: IQuoteCleanerOccurrenceProgress[],
  ): {
    totalOccurrences: number;
    completed: number;
    reportSubmitted: number;
    inProgress: number;
    pending: number;
    totalAmount: number;
    paidAmount: number;
    latestSubmittedAt?: Date;
    latestApprovedAt?: Date;
    latestArrivalAt?: Date;
  } {
    return occurrenceProgress.reduce(
      (acc, entry) => {
        const status = this.deriveOccurrenceProgressStatus(entry);
        acc.totalOccurrences += 1;
        const amount = this.asFiniteNumber(entry.cleanerEarningAmount) || 0;
        acc.totalAmount += amount;
        if (entry.paymentStatus === "paid") {
          acc.paidAmount += amount;
        }

        if (status === "completed") {
          acc.completed += 1;
        } else if (status === "waiting-for-admin-approval") {
          acc.reportSubmitted += 1;
        } else if (status === "ongoing") {
          acc.inProgress += 1;
        } else {
          acc.pending += 1;
        }

        if (
          entry.reportSubmittedAt &&
          (!acc.latestSubmittedAt || entry.reportSubmittedAt > acc.latestSubmittedAt)
        ) {
          acc.latestSubmittedAt = entry.reportSubmittedAt;
        }

        if (
          entry.reportApprovedAt &&
          (!acc.latestApprovedAt || entry.reportApprovedAt > acc.latestApprovedAt)
        ) {
          acc.latestApprovedAt = entry.reportApprovedAt;
        }

        if (
          entry.arrivalMarkedAt &&
          (!acc.latestArrivalAt || entry.arrivalMarkedAt > acc.latestArrivalAt)
        ) {
          acc.latestArrivalAt = entry.arrivalMarkedAt;
        }

        return acc;
      },
      {
        totalOccurrences: 0,
        completed: 0,
        reportSubmitted: 0,
        inProgress: 0,
        pending: 0,
        totalAmount: 0,
        paidAmount: 0,
        latestSubmittedAt: undefined as Date | undefined,
        latestApprovedAt: undefined as Date | undefined,
        latestArrivalAt: undefined as Date | undefined,
      },
    );
  }

  private buildOccurrenceSummaryMetrics(
    occurrenceProgress: IQuoteCleanerOccurrenceProgress[],
  ): QuoteOccurrenceProgressSummary & {
    latestSubmittedAt?: Date;
    latestSubmittedBy?: string;
  } {
    return occurrenceProgress.reduce(
      (acc, entry) => {
        const status = this.deriveOccurrenceProgressStatus(entry);
        acc.totalAssignments += 1;
        if (status === "completed") {
          acc.completed += 1;
        } else if (status === "waiting-for-admin-approval") {
          acc.reportSubmitted += 1;
        } else if (status === "ongoing") {
          acc.inProgress += 1;
        } else {
          acc.pending += 1;
        }

        if (entry.paymentStatus === "paid") {
          acc.paid += 1;
        } else {
          acc.unpaid += 1;
        }

        if (
          entry.reportSubmittedAt &&
          (!acc.latestSubmittedAt || entry.reportSubmittedAt > acc.latestSubmittedAt)
        ) {
          acc.latestSubmittedAt = entry.reportSubmittedAt;
          acc.latestSubmittedBy = entry.cleanerId.toString();
        }

        return acc;
      },
      {
        totalAssignments: 0,
        pending: 0,
        inProgress: 0,
        reportSubmitted: 0,
        completed: 0,
        paid: 0,
        unpaid: 0,
        totalOccurrences: new Set(
          occurrenceProgress.map((entry) => entry.occurrenceDate),
        ).size,
        latestSubmittedAt: undefined as Date | undefined,
        latestSubmittedBy: undefined as string | undefined,
      },
    );
  }

  private deriveOccurrenceProgressStatus(
    progress: IQuoteCleanerOccurrenceProgress,
  ): string {
    if (
      progress.reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
      progress.paymentStatus === "paid"
    ) {
      return "completed";
    }

    if (progress.reportStatus === QUOTE.REPORT_STATUSES.PENDING) {
      return "waiting-for-admin-approval";
    }

    if (progress.cleaningStatus === QUOTE.CLEANING_STATUSES.IN_PROGRESS) {
      return "ongoing";
    }

    return "pending";
  }

  private deriveManualCleanerStatus(metrics: {
    totalOccurrences: number;
    completed: number;
    reportSubmitted: number;
    inProgress: number;
    pending: number;
  }): string {
    if (
      metrics.totalOccurrences > 0 &&
      metrics.completed === metrics.totalOccurrences
    ) {
      return "completed";
    }

    if (
      metrics.reportSubmitted > 0 &&
      metrics.pending === 0 &&
      metrics.inProgress === 0
    ) {
      return "waiting-for-admin-approval";
    }

    if (
      metrics.inProgress > 0 ||
      metrics.reportSubmitted > 0 ||
      metrics.completed > 0
    ) {
      return "ongoing";
    }

    return "pending";
  }

  private deriveCleanerProgressStatus(progress: IQuoteCleanerProgress): string {
    if (
      progress.reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
      progress.paymentStatus === "paid"
    ) {
      return "completed";
    }

    if (progress.reportStatus === QUOTE.REPORT_STATUSES.PENDING) {
      return "waiting-for-admin-approval";
    }

    if (progress.cleaningStatus === QUOTE.CLEANING_STATUSES.IN_PROGRESS) {
      return "ongoing";
    }

    return "pending";
  }

  private resolveResidentialCleanerAmount(
    quote: IQuote,
    perCleanerPercentage?: number,
  ): number | undefined {
    const totalPrice = this.resolveQuoteTotal(quote);
    if (
      totalPrice > 0 &&
      perCleanerPercentage !== undefined &&
      perCleanerPercentage > 0
    ) {
      return Number(((totalPrice * perCleanerPercentage) / 100).toFixed(2));
    }

    const rawAmount = this.asFiniteNumber(quote.cleanerEarningAmount);
    if (rawAmount !== undefined) {
      return Number(rawAmount.toFixed(2));
    }

    return undefined;
  }

  private resolveQuoteTotal(quote: IQuote): number {
    if (quote.totalPrice && quote.totalPrice > 0) {
      return quote.totalPrice;
    }

    if (quote.paymentAmount && quote.paymentAmount > 0) {
      return Number((quote.paymentAmount / 100).toFixed(2));
    }

    return 0;
  }

  private normalizeCleanerIds(cleanerIds: string[]): string[] {
    return Array.from(
      new Set(
        (Array.isArray(cleanerIds) ? cleanerIds : [])
          .map((id) => id?.toString().trim())
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }

  private async resolveCleanerUsers(cleanerIds: string[]): Promise<IUser[]> {
    const uniqueCleanerIds = this.normalizeCleanerIds(cleanerIds);

    return Promise.all(
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
  }

  private async assertCleanersAvailableForServiceDate(
    cleanerIds: string[],
    serviceDate: string,
    excludeQuoteId?: string,
  ): Promise<void> {
    const uniqueCleanerIds = this.normalizeCleanerIds(cleanerIds);
    const normalizedServiceDate = serviceDate?.toString().trim();
    if (!uniqueCleanerIds.length || !normalizedServiceDate) {
      return;
    }

    const conflicts = await this.quoteRepository.findCleanerDateConflicts(
      uniqueCleanerIds,
      normalizedServiceDate,
      excludeQuoteId,
    );
    if (!conflicts.length) {
      return;
    }

    const requestedSet = new Set(uniqueCleanerIds.map((id) => id.toString()));
    const conflictingCleanerIds = new Set<string>();

    for (const conflict of conflicts) {
      for (const cleanerId of this.extractAssignedCleanerIds(conflict)) {
        if (requestedSet.has(cleanerId.toString())) {
          conflictingCleanerIds.add(cleanerId.toString());
        }
      }
    }

    const conflictingNames: string[] = [];
    for (const cleanerId of conflictingCleanerIds) {
      try {
        const cleaner = await this.userService.getById(cleanerId);
        if (!cleaner) continue;
        conflictingNames.push(
          cleaner.fullName?.trim() || cleaner.email || cleanerId,
        );
      } catch {
        conflictingNames.push(cleanerId);
      }
    }

    const label = conflictingNames.length
      ? conflictingNames.join(", ")
      : "selected cleaner(s)";

    throw new ConflictException(
      `${label} already assigned to another booking on ${normalizedServiceDate}.`,
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
    notifyClient?: boolean;
  }): Promise<void> {
    const { quote, quoteId, cleaners, assignmentType, notifyClient = true } =
      params;
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
    if (notifyClient && clientUserId) {
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
    if (notifyClient && clientEmail) {
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

  toCleanerFacingResponse(
    quote: IQuote,
    cleanerId?: string,
    occurrenceDateOrBase?: string | QuoteResponse,
    maybeBase?: QuoteResponse,
  ): QuoteResponse {
    const occurrenceDate =
      typeof occurrenceDateOrBase === "string" ? occurrenceDateOrBase : undefined;
    const base =
      typeof occurrenceDateOrBase === "string"
        ? maybeBase
        : occurrenceDateOrBase;
    const response = base || this.toResponse(quote);
    const cleanerProgress = this.resolveCleanerProgressForCleaner(quote, cleanerId);
    const cleanerOccurrenceProgress = this.resolveOccurrenceProgressForCleaner(
      quote,
      cleanerId,
    );
    const activeOccurrence = this.resolveOccurrenceProgressForCleanerAndDate(
      quote,
      cleanerId,
      occurrenceDate,
    );
    const allocatedAmount = this.resolveCleanerAllocatedAmountForQuote(
      quote,
      cleanerId,
    );
    const isCompleted = this.isQuoteCompletedForCleanerPayment(quote, cleanerId);
    const cleanerProgressResponse = cleanerProgress
      ? this.toCleanerProgressResponse(quote, cleanerProgress)
      : undefined;
    const occurrenceProgressResponses = cleanerOccurrenceProgress.map((entry) =>
      this.toOccurrenceProgressResponse(entry),
    );
    const occurrenceSummaryMetrics = cleanerOccurrenceProgress.length
      ? this.buildOccurrenceSummaryMetrics(cleanerOccurrenceProgress)
      : undefined;
    const activeOccurrenceResponse = activeOccurrence
      ? this.toOccurrenceProgressResponse(activeOccurrence)
      : undefined;

    return {
      ...response,
      cleaningStatus:
        activeOccurrence?.cleaningStatus ||
        cleanerProgress?.cleaningStatus ||
        response.cleaningStatus,
      reportStatus:
        activeOccurrence?.reportStatus ||
        cleanerProgress?.reportStatus ||
        response.reportStatus,
      reportSubmittedAt:
        activeOccurrence?.reportSubmittedAt ||
        cleanerProgress?.reportSubmittedAt ||
        response.reportSubmittedAt,
      cleanerEarningAmount: Number(
        (
          this.asFiniteNumber(activeOccurrence?.cleanerEarningAmount) ??
          allocatedAmount
        ).toFixed(2),
      ),
      paymentStatus:
        activeOccurrence?.paymentStatus ||
        cleanerProgress?.paymentStatus ||
        (isCompleted ? "paid" : "pending"),
      cleanerPaidAmount:
        cleanerProgressResponse?.paidAmount ?? response.cleanerPaidAmount,
      cleanerPendingAmount:
        cleanerProgressResponse?.pendingAmount ?? response.cleanerPendingAmount,
      activeCleanerProgress: cleanerProgressResponse,
      cleanerProgress: cleanerProgressResponse
        ? [cleanerProgressResponse]
        : response.cleanerProgress,
      cleanerProgressSummary: cleanerProgressResponse
        ? {
            totalAssigned: 1,
            pending: cleanerProgressResponse.cleanerStatus === "pending" ? 1 : 0,
            inProgress: cleanerProgressResponse.cleanerStatus === "ongoing" ? 1 : 0,
            reportSubmitted:
              cleanerProgressResponse.cleanerStatus ===
              "waiting-for-admin-approval"
                ? 1
                : 0,
            completed:
              cleanerProgressResponse.cleanerStatus === "completed" ? 1 : 0,
            paid: cleanerProgressResponse.paymentStatus === "paid" ? 1 : 0,
            unpaid: cleanerProgressResponse.paymentStatus === "paid" ? 0 : 1,
          }
        : response.cleanerProgressSummary,
      occurrenceProgress: occurrenceProgressResponses.length
        ? occurrenceProgressResponses
        : response.occurrenceProgress,
      occurrenceProgressSummary: occurrenceSummaryMetrics
        ? {
            totalAssignments: occurrenceSummaryMetrics.totalAssignments,
            pending: occurrenceSummaryMetrics.pending,
            inProgress: occurrenceSummaryMetrics.inProgress,
            reportSubmitted: occurrenceSummaryMetrics.reportSubmitted,
            completed: occurrenceSummaryMetrics.completed,
            paid: occurrenceSummaryMetrics.paid,
            unpaid: occurrenceSummaryMetrics.unpaid,
            totalOccurrences: occurrenceSummaryMetrics.totalOccurrences,
          }
        : response.occurrenceProgressSummary,
      activeOccurrenceProgress:
        activeOccurrenceResponse || response.activeOccurrenceProgress,
      cleanerStatus:
        activeOccurrenceResponse?.cleanerStatus ||
        cleanerProgressResponse?.cleanerStatus ||
        response.cleanerStatus,
    };
  }

  private isQuoteCompletedForCleanerPayment(
    quote: IQuote,
    cleanerId?: string,
  ): boolean {
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    const status = (quote.status || "").toLowerCase();
    const reportStatus = (quote.reportStatus || "").toLowerCase();

    if (serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL) {
      const cleanerProgress = this.resolveCleanerProgressForCleaner(quote, cleanerId);
      if (cleanerProgress) {
        return (
          cleanerProgress.paymentStatus === "paid" ||
          cleanerProgress.reportStatus === QUOTE.REPORT_STATUSES.APPROVED
        );
      }

      return (
        reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
        status === QUOTE.STATUSES.COMPLETED ||
        status === QUOTE.STATUSES.REVIEWED
      );
    }

    const occurrenceProgress = this.resolveOccurrenceProgressForCleaner(
      quote,
      cleanerId,
    );
    if (occurrenceProgress.length > 0) {
      const metrics = this.buildCleanerMetricsFromOccurrences(occurrenceProgress);
      return (
        metrics.totalOccurrences > 0 &&
        metrics.completed === metrics.totalOccurrences
      );
    }

    return (
      status === QUOTE.STATUSES.CLOSED ||
      status === QUOTE.STATUSES.COMPLETED ||
      status === QUOTE.STATUSES.REVIEWED
    );
  }

  private resolveCleanerAllocatedAmountForQuote(
    quote: IQuote,
    cleanerId?: string,
  ): number {
    const serviceType = quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL;
    if (this.isManualServiceType(serviceType)) {
      const occurrenceProgress = this.resolveOccurrenceProgressForCleaner(
        quote,
        cleanerId,
      );
      if (occurrenceProgress.length > 0) {
        const metrics = this.buildCleanerMetricsFromOccurrences(occurrenceProgress);
        return Number(metrics.totalAmount.toFixed(2));
      }
    }

    const cleanerProgress = this.resolveCleanerProgressForCleaner(quote, cleanerId);
    if (cleanerProgress) {
      const progressAmount = this.asFiniteNumber(cleanerProgress.cleanerEarningAmount);
      if (progressAmount !== undefined) {
        return Number(progressAmount.toFixed(2));
      }

      const progressPct = this.asFiniteNumber(cleanerProgress.cleanerPercentage);
      if (progressPct !== undefined) {
        const totalPrice = this.resolveQuoteTotal(quote);
        if (totalPrice > 0) {
          return Number(((totalPrice * progressPct) / 100).toFixed(2));
        }
      }
    }

    const cleanerCount = this.resolveAssignedCleanerCount(quote);
    const rawCleanerAmount = this.asFiniteNumber(quote.cleanerEarningAmount);
    const totalPrice = this.resolveQuoteTotal(quote) || undefined;
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
    if (!ids.length) {
      const cleanerProgress = this.getNormalizedCleanerProgress(quote);
      if (cleanerProgress.length) {
        return cleanerProgress.length;
      }
    }
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

  async deleteQuotesBulk(
    quoteIds: string[],
  ): Promise<{ requestedCount: number; deletedCount: number; skippedIds: string[] }> {
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(quoteIds) ? quoteIds : [])
          .map((id) => id?.toString().trim())
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (!normalizedIds.length) {
      throw new BadRequestException("At least one quote id is required");
    }

    const validObjectIds = normalizedIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    if (!validObjectIds.length) {
      throw new BadRequestException("No valid quote ids provided");
    }

    const existingQuotes = await this.quoteRepository.find({
      _id: { $in: validObjectIds },
      isDeleted: { $ne: true },
    });

    const existingIdSet = new Set(
      existingQuotes.map((quote) => quote._id.toString()),
    );
    const deletableIds = normalizedIds.filter((id) => existingIdSet.has(id));

    if (!deletableIds.length) {
      throw new NotFoundException("No active quotes found for the provided ids");
    }

    const deletedCount = await this.quoteRepository.softDeleteManyByIds(
      deletableIds,
    );
    const skippedIds = normalizedIds.filter((id) => !existingIdSet.has(id));

    return {
      requestedCount: normalizedIds.length,
      deletedCount,
      skippedIds,
    };
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
        const occurrenceProgress = this.resolveOccurrenceProgressForCleaner(
          quote as IQuote,
          cleanerId,
        );

        if (occurrenceProgress.length > 0) {
          const metrics = this.buildCleanerMetricsFromOccurrences(occurrenceProgress);
          acc.totalJobs += 1;
          acc.totalEarning += Number(metrics.totalAmount.toFixed(2));
          acc.paidAmount += Number(metrics.paidAmount.toFixed(2));
          acc.pendingAmount += Number(
            Math.max(metrics.totalAmount - metrics.paidAmount, 0).toFixed(2),
          );
          return acc;
        }

        const amount = this.resolveCleanerAllocatedAmountForQuote(
          quote as IQuote,
          cleanerId,
        );
        const roundedAmount = Number(amount.toFixed(2));

        acc.totalJobs += 1;
        acc.totalEarning += roundedAmount;

        if (this.isQuoteCompletedForCleanerPayment(quote as IQuote, cleanerId)) {
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
    occurrenceDate?: string,
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
      await this.attachCleaningReport(response, quote, undefined, occurrenceDate);
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
      const response = await this.buildResponseWithCleanerDetails(
        quote,
        requester.userId,
      );
      const cleanerResponse = this.toCleanerFacingResponse(
        quote,
        requester.userId,
        occurrenceDate,
        response,
      );
      await this.attachCleaningReport(
        cleanerResponse,
        quote,
        requester.userId,
        occurrenceDate,
      );
      return cleanerResponse;
    }

    if (requester.role === ROLES.CLIENT) {
      if (!quote.userId || quote.userId.toString() !== requester.userId) {
        throw new ForbiddenException("Client does not own this quote");
      }
      const response = await this.buildResponseWithCleanerDetails(quote);
      await this.attachCleaningReport(response, quote, undefined, occurrenceDate);
      return response;
    }

    throw new ForbiddenException("User is not authorized to access this quote");
  }

  private async buildResponseWithCleanerDetails(
    quote: IQuote,
    activeCleanerId?: string,
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
      const cleanerProgressMap = new Map(
        (response.cleanerProgress || []).map((entry) => [entry.cleanerId, entry]),
      );
      response.assignedCleaners = cleaners.map((c) => ({
        _id: c._id,
        fullName: c.fullName,
        email: c.email,
        phone: c.phone,
        cleanerProgress: cleanerProgressMap.get(c._id.toString()),
      }));
    } catch (error) {
      logger.warn(
        { quoteId: quote._id.toString(), error },
        "Failed to load assigned cleaner details",
      );
    }

    if (activeCleanerId) {
      response.activeCleanerProgress =
        response.cleanerProgress?.find(
          (entry) => entry.cleanerId === activeCleanerId,
        ) || response.activeCleanerProgress;
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
    cleanerId?: string,
    occurrenceDate?: string,
  ): Promise<void> {
    const report =
      cleanerId && occurrenceDate
        ? await this.cleaningReportRepository.findByQuoteAndOccurrence(
            quote._id.toString(),
            occurrenceDate,
            cleanerId,
          )
        : occurrenceDate
          ? await this.cleaningReportRepository.findByQuoteAndOccurrence(
              quote._id.toString(),
              occurrenceDate,
            )
          : cleanerId
            ? await this.cleaningReportRepository.findByQuoteIdAndCleanerId(
                quote._id.toString(),
                cleanerId,
              )
            : await this.cleaningReportRepository.findByQuoteId(
                quote._id.toString(),
              );
    if (!report) {
      return;
    }

    response.cleaningReport = {
      occurrenceDate: report.occurrenceDate,
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
    occurrenceDate?: string,
  ): Promise<QuoteResponse> {
    const quote = await this.quoteRepository.findById(quoteId);

    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    const requesterId = requester.userId?.toString();
    const isAssignedCleaner =
      requester.role === ROLES.CLEANER &&
      requesterId &&
      ((quote.assignedCleanerId &&
        quote.assignedCleanerId.toString() === requesterId) ||
        (quote.assignedCleanerIds || [])
          .map((id) => id.toString())
          .includes(requesterId));

    if (!isAssignedCleaner) {
      throw new ForbiddenException(
        "Only an assigned cleaner can mark arrival for this quote",
      );
    }

    const isManualService = this.isManualServiceType(
      quote.serviceType || QUOTE.SERVICE_TYPES.RESIDENTIAL,
    );
    if (isManualService && !occurrenceDate) {
      throw new BadRequestException(
        "Occurrence date is required to mark arrival for this booking",
      );
    }

    const cleanerProgress = this.resolveCleanerProgressForCleaner(quote, requesterId);
    const activeOccurrence = isManualService
      ? this.resolveOccurrenceProgressForCleanerAndDate(
          quote,
          requesterId,
          occurrenceDate,
        )
      : undefined;
    const currentStatus =
      activeOccurrence?.cleaningStatus ||
      cleanerProgress?.cleaningStatus ||
      quote.cleaningStatus ||
      QUOTE.CLEANING_STATUSES.PENDING;

    if (
      activeOccurrence?.reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
      cleanerProgress?.reportStatus === QUOTE.REPORT_STATUSES.APPROVED ||
      currentStatus === QUOTE.CLEANING_STATUSES.COMPLETED
    ) {
      throw new BadRequestException("This cleaner has already completed the job");
    }

    if (currentStatus === QUOTE.CLEANING_STATUSES.IN_PROGRESS) {
      return this.toCleanerFacingResponse(quote, requesterId, occurrenceDate);
    }

    const updatePayload =
      quote.serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? this.buildResidentialArrivalUpdate(quote, requesterId!, new Date())
        : this.buildManualOccurrenceArrivalUpdate(
            quote,
            requesterId!,
            occurrenceDate!,
            new Date(),
          );
    const updated = await this.quoteRepository.updateById(quoteId, updatePayload);

    if (!updated) {
      throw new NotFoundException("Quote not found");
    }

    return requesterId
      ? this.toCleanerFacingResponse(updated, requesterId, occurrenceDate)
      : this.toResponse(updated);
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
    const serviceTypeLabel = this.serviceTypeLabel(quote.serviceType);

    await this.notificationRepository.createOnce({
      quoteId: quote._id.toString(),
      event: "quote_submitted",
      eventKey: "created",
      title: "New booking/quote created",
      message: `${serviceTypeLabel} booking #${quote._id.toString()} was created by ${clientName}.`,
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

    realtimeService.emitAdminQuoteCreated({
      quoteId: quote._id.toString(),
      serviceType: serviceTypeLabel,
      clientName,
      clientEmail: quote.email,
      serviceDate: quote.serviceDate,
      preferredTime,
      companyName: quote.companyName,
      createdAt: new Date().toISOString(),
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

  private normalizeCleaningFrequency(
    scheduleFrequency?: QuoteCleaningSchedule["frequency"],
    fallbackValue?: string,
  ): string {
    if (scheduleFrequency === "one_time") {
      return "one-time";
    }
    if (scheduleFrequency === "weekly" || scheduleFrequency === "monthly") {
      return scheduleFrequency;
    }

    const normalized = (fallbackValue || "")
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

  private parseScheduleMonths(months?: number[]): number[] {
    const normalized = Array.from(
      new Set(
        (Array.isArray(months) ? months : [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 12),
      ),
    ).sort((a, b) => a - b);

    return normalized;
  }

  private normalizeScheduleMonths(months?: number[]): number[] {
    const normalized = this.parseScheduleMonths(months);
    return normalized.length ? normalized : [...QUOTE_SCHEDULE_MONTHS];
  }

  private maxDayForMonth(month: number): number {
    return MONTH_DAY_LIMITS[month] || 31;
  }

  private normalizeDatesForMonth(dates: number[] | undefined, month: number): number[] {
    const maxDay = this.maxDayForMonth(month);
    return Array.from(
      new Set(
        (Array.isArray(dates) ? dates : [])
          .map((value) => Number(value))
          .filter(
            (value) => Number.isInteger(value) && value >= 1 && value <= maxDay,
          ),
      ),
    ).sort((a, b) => a - b);
  }

  private normalizeMonthDateSelections(
    months: number[],
    monthDateEntries?: Array<{ month: number; dates: number[] }>,
    legacyDates?: number[],
  ): Array<{ month: number; dates: number[] }> {
    const fallbackDates = Array.from(
      new Set(
        (Array.isArray(legacyDates) ? legacyDates : [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31),
      ),
    ).sort((a, b) => a - b);

    const monthDateMap = new Map<number, number[]>();

    if (Array.isArray(monthDateEntries) && monthDateEntries.length > 0) {
      for (const entry of monthDateEntries) {
        const month = Number(entry.month);
        if (!months.includes(month)) {
          continue;
        }
        const dates = this.normalizeDatesForMonth(entry.dates, month);
        if (dates.length) {
          monthDateMap.set(month, dates);
        }
      }
    } else {
      for (const month of months) {
        const dates = this.normalizeDatesForMonth(fallbackDates, month);
        if (dates.length) {
          monthDateMap.set(month, dates);
        }
      }
    }

    const selections = months.map((month) => ({
      month,
      dates: monthDateMap.get(month) || [],
    }));

    const missingMonths = selections
      .filter((entry) => entry.dates.length === 0)
      .map((entry) => entry.month);
    if (missingMonths.length) {
      throw new BadRequestException(
        "Each selected month must include at least one valid date",
      );
    }

    return selections;
  }

  private resolveMonthlyDatesMap(
    schedule: QuoteCleaningScheduleMonthlySpecificDates,
  ): Map<number, number[]> {
    const months = this.normalizeScheduleMonths(schedule.months);
    const result = new Map<number, number[]>();

    if (Array.isArray(schedule.month_dates) && schedule.month_dates.length > 0) {
      for (const entry of schedule.month_dates) {
        const month = Number(entry.month);
        if (!months.includes(month)) {
          continue;
        }
        const dates = this.normalizeDatesForMonth(entry.dates, month);
        if (dates.length) {
          result.set(month, dates);
        }
      }
    } else {
      const fallbackDates = Array.from(
        new Set(
          (Array.isArray(schedule.dates) ? schedule.dates : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31),
        ),
      ).sort((a, b) => a - b);

      for (const month of months) {
        const dates = this.normalizeDatesForMonth(fallbackDates, month);
        if (dates.length) {
          result.set(month, dates);
        }
      }
    }

    return result;
  }

  private normalizeCleaningSchedule(
    schedule?: QuoteCleaningSchedule,
  ): QuoteCleaningSchedule | undefined {
    if (!schedule) {
      return undefined;
    }

    if (schedule.frequency === "one_time") {
      const date = schedule.schedule.date.trim();
      const start_time = this.normalizeAndValidateTime(schedule.schedule.start_time);
      const end_time = this.normalizeAndValidateTime(schedule.schedule.end_time);
      this.ensureDateString(date, "Schedule date");
      this.ensureEndAfterStart(start_time, end_time);

      return {
        frequency: "one_time",
        schedule: {
          date,
          start_time,
          end_time,
        },
      };
    }

    if (schedule.frequency === "weekly") {
      const days = Array.from(
        new Set(
          schedule.days
            .map((day) => day.trim().toLowerCase() as QuoteScheduleWeekday)
            .filter((day) => QUOTE_SCHEDULE_WEEKDAYS.includes(day)),
        ),
      );
      if (!days.length) {
        throw new BadRequestException("At least one weekday is required");
      }

      const start_time = this.normalizeAndValidateTime(schedule.start_time);
      const end_time = this.normalizeAndValidateTime(schedule.end_time);
      this.ensureEndAfterStart(start_time, end_time);
      const repeat_until = schedule.repeat_until?.trim() || undefined;
      if (repeat_until) {
        this.ensureDateString(repeat_until, "Repeat until date");
      }

      return {
        frequency: "weekly",
        days,
        start_time,
        end_time,
        repeat_until,
      };
    }

    if (schedule.pattern_type === "specific_dates") {
      const explicitMonths = this.parseScheduleMonths(schedule.months);
      const monthDatesMonths = this.parseScheduleMonths(
        Array.isArray(schedule.month_dates)
          ? schedule.month_dates.map((entry) => Number(entry.month))
          : [],
      );
      const months = explicitMonths.length
        ? explicitMonths
        : monthDatesMonths.length
        ? monthDatesMonths
        : [...QUOTE_SCHEDULE_MONTHS];
      const month_dates = this.normalizeMonthDateSelections(
        months,
        schedule.month_dates,
        schedule.dates,
      );
      const dates = Array.from(
        new Set(month_dates.flatMap((entry) => entry.dates)),
      ).sort((a, b) => a - b);

      const start_time = this.normalizeAndValidateTime(schedule.start_time);
      const end_time = this.normalizeAndValidateTime(schedule.end_time);
      this.ensureEndAfterStart(start_time, end_time);

      return {
        frequency: "monthly",
        pattern_type: "specific_dates",
        year:
          typeof schedule.year === "number" && Number.isInteger(schedule.year)
            ? schedule.year
            : undefined,
        months,
        month_dates,
        dates,
        start_time,
        end_time,
      };
    }

    const week = schedule.week.trim().toLowerCase() as QuoteScheduleMonthWeek;
    const day = schedule.day.trim().toLowerCase() as QuoteScheduleWeekday;
    if (!["first", "second", "third", "fourth", "last"].includes(week)) {
      throw new BadRequestException("Invalid monthly week pattern");
    }
    if (!QUOTE_SCHEDULE_WEEKDAYS.includes(day)) {
      throw new BadRequestException("Invalid monthly weekday pattern");
    }

    const start_time = this.normalizeAndValidateTime(schedule.start_time);
    const end_time = this.normalizeAndValidateTime(schedule.end_time);
    this.ensureEndAfterStart(start_time, end_time);
    const months = this.normalizeScheduleMonths(schedule.months);

    return {
      frequency: "monthly",
      pattern_type: "weekday_pattern",
      year:
        typeof schedule.year === "number" && Number.isInteger(schedule.year)
          ? schedule.year
          : undefined,
      months,
      week,
      day,
      start_time,
      end_time,
    };
  }

  private resolvePrimarySchedule(
    schedule: QuoteCleaningSchedule | undefined,
    preferredDate?: string,
    preferredTime?: string,
  ): { serviceDate: string; preferredTime: string } {
    if (schedule) {
      const resolved = this.resolvePrimaryScheduleFromConfig(schedule, new Date());
      if (!resolved) {
        throw new BadRequestException("Could not derive a valid primary schedule");
      }
      return resolved;
    }

    const serviceDate = preferredDate?.trim() || "";
    const normalizedPreferredTime = this.normalizeAndValidateTime(preferredTime || "");
    this.ensureDateString(serviceDate, "Preferred date");

    return {
      serviceDate,
      preferredTime: normalizedPreferredTime,
    };
  }

  private resolvePrimaryScheduleFromConfig(
    schedule: QuoteCleaningSchedule,
    now: Date,
  ): { serviceDate: string; preferredTime: string } | null {
    if (schedule.frequency === "one_time") {
      return {
        serviceDate: schedule.schedule.date,
        preferredTime: schedule.schedule.start_time,
      };
    }

    if (schedule.frequency === "weekly") {
      const date = this.findNextWeeklyDate(schedule, now);
      if (!date) {
        return null;
      }
      return {
        serviceDate: date,
        preferredTime: schedule.start_time,
      };
    }

    if (schedule.pattern_type === "specific_dates") {
      const date = this.findNextMonthlySpecificDate(schedule, now);
      if (!date) {
        return null;
      }
      return {
        serviceDate: date,
        preferredTime: schedule.start_time,
      };
    }

    const date = this.findNextMonthlyWeekdayPatternDate(schedule, now);
    if (!date) {
      return null;
    }

    return {
      serviceDate: date,
      preferredTime: schedule.start_time,
    };
  }

  private findNextWeeklyDate(
    schedule: QuoteCleaningScheduleWeekly,
    now: Date,
  ): string | null {
    const daySet = new Set(schedule.days);
    const repeatUntil = schedule.repeat_until
      ? this.parseDateString(schedule.repeat_until)
      : null;
    const repeatUntilEnd = repeatUntil
      ? new Date(
          repeatUntil.getFullYear(),
          repeatUntil.getMonth(),
          repeatUntil.getDate(),
          23,
          59,
          59,
          999,
        )
      : null;
    const [hours, minutes] = schedule.start_time.split(":").map(Number);

    for (let offset = 0; offset <= 370; offset += 1) {
      const candidateDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offset,
      );
      if (repeatUntilEnd && candidateDay > repeatUntilEnd) {
        break;
      }

      const dayName = this.weekdayFromDate(candidateDay);
      if (!daySet.has(dayName)) {
        continue;
      }

      const occurrence = new Date(candidateDay);
      occurrence.setHours(hours, minutes, 0, 0);
      if (occurrence < now) {
        continue;
      }

      return this.toDateString(candidateDay);
    }

    return null;
  }

  private findNextMonthlySpecificDate(
    schedule: QuoteCleaningScheduleMonthlySpecificDates,
    now: Date,
  ): string | null {
    const [hours, minutes] = schedule.start_time.split(":").map(Number);
    const monthDatesMap = this.resolveMonthlyDatesMap(schedule);
    const scheduleYear =
      typeof schedule.year === "number" ? schedule.year : undefined;

    for (let monthOffset = 0; monthOffset <= 36; monthOffset += 1) {
      const monthRef = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
      const year = monthRef.getFullYear();
      if (scheduleYear !== undefined) {
        if (year < scheduleYear) {
          continue;
        }
        if (year > scheduleYear) {
          break;
        }
      }
      const month = monthRef.getMonth();
      const monthValue = month + 1;
      const selectedDates = monthDatesMap.get(monthValue) || [];
      if (!selectedDates.length) {
        continue;
      }
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (const selectedDay of selectedDates) {
        if (selectedDay > daysInMonth) {
          continue;
        }

        const candidate = new Date(year, month, selectedDay, hours, minutes, 0, 0);
        if (candidate < now) {
          continue;
        }

        return this.toDateString(candidate);
      }
    }

    return null;
  }

  private findNextMonthlyWeekdayPatternDate(
    schedule: QuoteCleaningScheduleMonthlyWeekdayPattern,
    now: Date,
  ): string | null {
    const [hours, minutes] = schedule.start_time.split(":").map(Number);
    const monthSet = new Set(this.normalizeScheduleMonths(schedule.months));
    const scheduleYear =
      typeof schedule.year === "number" ? schedule.year : undefined;

    for (let monthOffset = 0; monthOffset <= 36; monthOffset += 1) {
      const monthRef = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
      const year = monthRef.getFullYear();
      if (scheduleYear !== undefined) {
        if (year < scheduleYear) {
          continue;
        }
        if (year > scheduleYear) {
          break;
        }
      }
      const month = monthRef.getMonth();
      const monthValue = month + 1;
      if (!monthSet.has(monthValue)) {
        continue;
      }
      const dayOfMonth = this.getWeekdayPatternDayOfMonth(
        year,
        month,
        schedule.week,
        schedule.day,
      );

      if (!dayOfMonth) {
        continue;
      }

      const candidate = new Date(year, month, dayOfMonth, hours, minutes, 0, 0);
      if (candidate < now) {
        continue;
      }

      return this.toDateString(candidate);
    }

    return null;
  }

  private getWeekdayPatternDayOfMonth(
    year: number,
    month: number,
    week: QuoteScheduleMonthWeek,
    day: QuoteScheduleWeekday,
  ): number | null {
    const targetWeekday = SCHEDULE_WEEKDAY_TO_INDEX[day];
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    if (week === "last") {
      const lastDayWeekday = new Date(year, month, daysInMonth).getDay();
      const delta = (lastDayWeekday - targetWeekday + 7) % 7;
      return daysInMonth - delta;
    }

    const firstDayWeekday = new Date(year, month, 1).getDay();
    const offsetFromFirst = (targetWeekday - firstDayWeekday + 7) % 7;
    const weekOffset =
      week === "first"
        ? 0
        : week === "second"
          ? 1
          : week === "third"
            ? 2
            : 3;
    const dayOfMonth = 1 + offsetFromFirst + weekOffset * 7;

    if (dayOfMonth > daysInMonth) {
      return null;
    }

    return dayOfMonth;
  }

  private normalizeAndValidateTime(value: string): string {
    const normalized = normalizeTimeTo24Hour(value);
    if (!/^\d{2}:\d{2}$/.test(normalized)) {
      throw new BadRequestException("Time must be in HH:mm format");
    }
    return normalized;
  }

  private ensureEndAfterStart(startTime: string, endTime: string): void {
    const start = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);
    if (end <= start) {
      throw new BadRequestException("End time must be after start time");
    }
  }

  private ensureDateString(value: string, fieldName: string): void {
    if (!this.isValidDateString(value)) {
      throw new BadRequestException(`${fieldName} must be in YYYY-MM-DD format`);
    }
  }

  private isValidDateString(value: string): boolean {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    );
  }

  private parseDateString(value: string): Date {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new BadRequestException("Invalid date format");
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new BadRequestException("Invalid date value");
    }

    return parsed;
  }

  private parseDateOnly(value: string, fieldName: string): Date {
    this.ensureDateString(value, fieldName);
    return this.parseDateString(value);
  }

  private startOfDay(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return this.startOfDay(next);
  }

  private timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  private weekdayFromDate(value: Date): QuoteScheduleWeekday {
    switch (value.getDay()) {
      case 1:
        return "monday";
      case 2:
        return "tuesday";
      case 3:
        return "wednesday";
      case 4:
        return "thursday";
      case 5:
        return "friday";
      case 6:
        return "saturday";
      default:
        return "sunday";
    }
  }

  private toDateString(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private toAdminNotificationResponse(
    notification: IQuoteNotification,
  ): AdminQuoteNotificationResponse {
    return {
      _id: notification._id.toString(),
      quoteId:
        typeof notification.quoteId === "string"
          ? notification.quoteId
          : notification.quoteId?.toString() || "",
      event: notification.event,
      eventKey: notification.eventKey || "default",
      title: notification.title,
      message: notification.message,
      serviceType: notification.serviceType,
      clientName: notification.clientName,
      companyName: notification.companyName,
      email: notification.email,
      phoneNumber: notification.phoneNumber,
      businessAddress: notification.businessAddress,
      serviceDate: notification.serviceDate,
      preferredTime: notification.preferredTime,
      requestedServices: notification.requestedServices || [],
      notes: notification.notes,
      isRead: Boolean(notification.isRead),
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
    };
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
    const isManualService = this.isManualServiceType(serviceType);
    const cleanerProgressEntries = this.getNormalizedCleanerProgress(quote);
    const occurrenceProgressEntries = isManualService
      ? this.getCleanerOccurrenceProgress(quote)
      : [];
    const residentialAggregate =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL &&
      cleanerProgressEntries.length
        ? this.buildResidentialAggregateUpdateFromProgress(
            quote,
            cleanerProgressEntries,
          )
        : undefined;
    const manualAggregate =
      isManualService && occurrenceProgressEntries.length
        ? this.buildManualAggregateUpdateFromOccurrenceProgress(
            quote,
            occurrenceProgressEntries,
          )
        : undefined;
    const cleanerProgress = cleanerProgressEntries.length
      ? cleanerProgressEntries.map((entry) =>
          this.toCleanerProgressResponse(quote, entry),
        )
      : undefined;
    const cleanerProgressSummary = this.buildCleanerProgressSummary(quote);
    const occurrenceProgress = occurrenceProgressEntries.length
      ? occurrenceProgressEntries.map((entry) =>
          this.toOccurrenceProgressResponse(entry),
        )
      : undefined;
    const occurrenceProgressSummary =
      occurrenceProgressEntries.length > 0
        ? this.buildOccurrenceProgressSummary(quote)
        : undefined;
    const totalOccurrenceAmount = occurrenceProgressEntries.reduce(
      (sum, entry) => sum + (this.asFiniteNumber(entry.cleanerEarningAmount) || 0),
      0,
    );
    const paidOccurrenceAmount = occurrenceProgressEntries.reduce(
      (sum, entry) =>
        entry.paymentStatus === "paid"
          ? sum + (this.asFiniteNumber(entry.cleanerEarningAmount) || 0)
          : sum,
      0,
    );
    const aggregate = residentialAggregate || manualAggregate;
    const status =
      aggregate?.status ||
      quote.status ||
      (quote.paymentStatus === "paid" ? QUOTE.STATUSES.PAID : undefined);
    const derived = this.deriveStatuses(quote);
    const paymentStatus = isManualService
      ? quote.paymentStatus === "paid"
        ? "paid"
        : "manual"
      : quote.paymentStatus;
    const cleaningStatus =
      (aggregate?.cleaningStatus as any) ||
      quote.cleaningStatus ||
      (serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL ||
      occurrenceProgressEntries.length > 0
        ? QUOTE.CLEANING_STATUSES.PENDING
        : undefined);
    const reportStatus =
      (aggregate?.reportStatus as any) || quote.reportStatus;
    const reportSubmittedBy =
      (((aggregate?.reportSubmittedBy as any) || quote.reportSubmittedBy)?.toString());
    const reportSubmittedAt =
      aggregate?.reportSubmittedAt || quote.reportSubmittedAt;
    const cleanerSharePercentage =
      quote.cleanerSharePercentage ??
      (isManualService &&
      this.resolveQuoteTotal(quote) > 0 &&
      this.resolveManualCleanerPoolAmount(quote) > 0
        ? Number(
            (
              (this.resolveManualCleanerPoolAmount(quote) /
                this.resolveQuoteTotal(quote)) *
              100
            ).toFixed(4),
          )
        : serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
          ? quote.cleanerPercentage
          : undefined);
    const cleanerPercentage =
      quote.cleanerPercentage ??
      (cleanerSharePercentage !== undefined &&
      cleanerSharePercentage !== null
        ? Number(
            (
              cleanerSharePercentage /
              Math.max(this.resolveAssignedCleanerCount(quote), 1)
            ).toFixed(4),
          )
        : undefined);
    const cleanerEarningAmount =
      isManualService
        ? this.resolveManualCleanerPoolAmount(quote)
        : quote.cleanerEarningAmount ??
          (cleanerProgress?.length
            ? cleanerProgress[0].cleanerEarningAmount
            : undefined);

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
      cleanerPaidAmount: isManualService
        ? Number(paidOccurrenceAmount.toFixed(2))
        : undefined,
      cleanerPendingAmount: isManualService
        ? Number(Math.max(totalOccurrenceAmount - paidOccurrenceAmount, 0).toFixed(2))
        : undefined,
      occurrenceCount: occurrenceProgressSummary?.totalOccurrences,
      cleanerProgress,
      cleanerProgressSummary,
      occurrenceProgress,
      occurrenceProgressSummary,
      cleaningFrequency: quote.cleaningFrequency,
      cleaningSchedule: quote.cleaningSchedule,
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
    const cleanerSummary = this.buildCleanerProgressSummary(quote);
    const occurrenceSummary = isManualService
      ? this.buildOccurrenceProgressSummary(quote)
      : undefined;
    const hasCleaner =
      (cleanerSummary?.totalAssigned || 0) > 0 ||
      Boolean(quote.assignedCleanerId) ||
      Boolean(quote.assignedCleanerIds && quote.assignedCleanerIds.length);
    const cleaning = quote.cleaningStatus;
    const report = quote.reportStatus;
    const completedStatuses = new Set<string>([
      QUOTE.STATUSES.COMPLETED,
      QUOTE.STATUSES.REVIEWED,
    ]);
    const isClosed = quote.status === QUOTE.STATUSES.CLOSED;
    const residentialCompleted =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL &&
      Boolean(
        cleanerSummary &&
          cleanerSummary.totalAssigned > 0 &&
          cleanerSummary.completed === cleanerSummary.totalAssigned,
      );
    const manualCompleted =
      isManualService &&
      Boolean(
        occurrenceSummary &&
          occurrenceSummary.totalAssignments > 0 &&
          occurrenceSummary.completed === occurrenceSummary.totalAssignments,
      );
    const isCompleted =
      manualCompleted ||
      residentialCompleted ||
      report === QUOTE.REPORT_STATUSES.APPROVED ||
      (quote.status ? completedStatuses.has(quote.status) : false);

    const progressSummary =
      serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL
        ? cleanerSummary
        : occurrenceSummary;
    const hasRichProgress = Boolean(
      (serviceType === QUOTE.SERVICE_TYPES.RESIDENTIAL &&
        cleanerSummary &&
        cleanerSummary.totalAssigned > 0) ||
        (isManualService &&
          occurrenceSummary &&
          occurrenceSummary.totalAssignments > 0),
    );

    if (hasRichProgress && progressSummary) {
      const hasSubmitted =
        progressSummary.reportSubmitted > 0 || progressSummary.completed > 0;
      const allSubmittedOrCompleted =
        progressSummary.pending === 0 && progressSummary.inProgress === 0;

      const clientStatus = (() => {
        if (isClosed) return isManualService ? "completed" : "closed";
        if (isCompleted) return "completed";
        if (progressSummary.inProgress > 0) return "ongoing";
        if (hasSubmitted && allSubmittedOrCompleted) return "report_submitted";
        if (hasSubmitted) return "ongoing";
        if (hasCleaner) return "assigned";
        return "booked";
      })();

      const cleanerStatus = (() => {
        if (isClosed) return isManualService ? "completed" : "closed";
        if (isCompleted) return "completed";
        if (hasSubmitted && allSubmittedOrCompleted) {
          return "waiting-for-admin-approval";
        }
        if (progressSummary.inProgress > 0 || hasSubmitted) return "ongoing";
        if (hasCleaner) return "pending";
        return "pending";
      })();

      const adminStatus = (() => {
        if (isClosed) return "closed";
        if (isCompleted) return "completed";
        if (progressSummary.inProgress > 0) return "on_site";
        if (hasSubmitted) return "report_submitted";
        if (hasCleaner) return "assigned";
        return "pending";
      })();

      return { clientStatus, cleanerStatus, adminStatus };
    }

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
