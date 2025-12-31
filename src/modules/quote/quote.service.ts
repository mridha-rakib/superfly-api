import { logger } from "@/middlewares/pino-logger";
import { stripeService } from "@/services/stripe.service";
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@/utils/app-error.utils";
import { CleaningServiceService } from "../cleaning-service/cleaning-service.service";
import { UserService } from "../user/user.service";
import type { IQuote } from "./quote.interface";
import { QuotePricingService } from "./quote.pricing";
import { QuotePaymentDraftRepository } from "./quote-payment.repository";
import { QuoteRepository } from "./quote.repository";
import type {
  QuoteCreatePayload,
  QuotePaymentIntentResponse,
  QuoteResponse,
} from "./quote.type";

type QuoteContact = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
};

export class QuoteService {
  private quoteRepository: QuoteRepository;
  private paymentDraftRepository: QuotePaymentDraftRepository;
  private pricingService: QuotePricingService;
  private cleaningServiceService: CleaningServiceService;
  private userService: UserService;

  constructor() {
    this.quoteRepository = new QuoteRepository();
    this.paymentDraftRepository = new QuotePaymentDraftRepository();
    this.pricingService = new QuotePricingService();
    this.cleaningServiceService = new CleaningServiceService();
    this.userService = new UserService();
  }

  async createPaymentIntent(
    payload: QuoteCreatePayload,
    requestUserId?: string
  ): Promise<QuotePaymentIntentResponse> {
    const { contact, userId } = await this.resolveContact(
      payload,
      requestUserId
    );
    const pricingInput = this.normalizeServiceSelections(payload.services);
    const requestedCodes = Object.keys(pricingInput);
    const activeServices = requestedCodes.length
      ? await this.cleaningServiceService.getActiveServicesByCodes(
          requestedCodes
        )
      : [];

    if (requestedCodes.length > 0) {
      if (activeServices.length === 0) {
        throw new BadRequestException(
          "No active services configured for requested codes"
        );
      }

      this.ensureAllServicesFound(pricingInput, activeServices);
    }

    const pricing = this.pricingService.calculate(pricingInput, activeServices);
    const amount = this.toMinorAmount(pricing.total);
    const serviceDate = payload.serviceDate.trim();

    if (amount <= 0) {
      throw new BadRequestException("Total amount must be greater than zero");
    }

    const paymentIntent = await stripeService.createPaymentIntent({
      amount,
      currency: pricing.currency.toLowerCase(),
      receipt_email: contact.email,
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId: userId || "",
        serviceDate,
      },
    });

    if (!paymentIntent.client_secret) {
      throw new BadRequestException("Payment intent could not be initialized");
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
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount,
      currency: pricing.currency,
    };
  }

  async confirmPayment(
    paymentIntentId: string,
    requestUserId?: string
  ): Promise<QuoteResponse> {
    const draft = await this.paymentDraftRepository.findByPaymentIntentId(
      paymentIntentId
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
        draft.quoteId.toString()
      );
      if (existingQuote) {
        return this.toResponse(existingQuote);
      }
    }

    const paymentIntent = await stripeService.retrievePaymentIntent(
      paymentIntentId
    );

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

  private async resolveContact(
    payload: QuoteCreatePayload,
    requestUserId?: string
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

  private splitFullName(
    fullName: string
  ): { firstName: string; lastName: string } {
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

  private normalizeServiceSelections(
    selections: QuoteCreatePayload["services"]
  ): QuoteCreatePayload["services"] {
    const normalized: QuoteCreatePayload["services"] = {};
    Object.entries(selections || {}).forEach(([key, value]) => {
      normalized[key.trim().toLowerCase()] = value ?? 0;
    });
    return normalized;
  }

  private ensureAllServicesFound(
    selections: QuoteCreatePayload["services"],
    services: { code: string }[]
  ): void {
    const availableCodes = new Set(services.map((service) => service.code));
    const unknown = Object.keys(selections).filter(
      (code) => !availableCodes.has(code)
    );

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown service codes: ${unknown.join(", ")}`
      );
    }
  }

  private toResponse(quote: IQuote): QuoteResponse {
    return {
      _id: quote._id.toString(),
      userId: quote.userId?.toString(),
      firstName: quote.firstName,
      lastName: quote.lastName,
      email: quote.email,
      phoneNumber: quote.phoneNumber,
      serviceDate: quote.serviceDate,
      notes: quote.notes,
      services: quote.services,
      totalPrice: quote.totalPrice,
      currency: quote.currency,
      paymentIntentId: quote.paymentIntentId,
      paymentAmount: quote.paymentAmount,
      paymentStatus: quote.paymentStatus,
      paidAt: quote.paidAt,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }

  private toMinorAmount(amount: number): number {
    return Math.round(amount * 100);
  }
}
