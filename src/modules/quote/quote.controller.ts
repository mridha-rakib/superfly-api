import { MESSAGES, QUOTE } from "@/constants/app.constants";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { PaginationHelper } from "@/utils/pagination-helper";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import { Types } from "mongoose";
import {
  assignQuoteCleanerSchema,
  confirmQuotePaymentSchema,
  createQuoteAuthSchema,
  createQuoteGuestSchema,
  createServiceRequestAuthSchema,
  createServiceRequestGuestSchema,
  quoteDetailSchema,
  quotePaymentStatusSchema,
  updateQuoteStatusSchema,
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

    ApiResponse.success(res, intent, "Payment session created successfully");
  });

  confirmPayment = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(confirmQuotePaymentSchema, req);
    const quote = await this.quoteService.confirmPayment(
      validated.body,
      req.user?.userId
    );

    ApiResponse.created(res, quote, "Quote created successfully");
  });

  getPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(quotePaymentStatusSchema, req);
    const status = await this.quoteService.getPaymentStatus(
      validated.query,
      req.user?.userId
    );

    ApiResponse.success(res, status, "Payment status fetched successfully");
  });

  createCommercialRequest = asyncHandler(
    async (req: Request, res: Response) => {
      const schema = req.user
        ? createServiceRequestAuthSchema
        : createServiceRequestGuestSchema;
      const validated = await zParse(schema, req);

      const quote = await this.quoteService.createServiceRequest(
        { ...validated.body, serviceType: QUOTE.SERVICE_TYPES.COMMERCIAL },
        req.user?.userId
      );

      ApiResponse.created(res, quote, "Quote request submitted successfully");
    }
  );

  createPostConstructionRequest = asyncHandler(
    async (req: Request, res: Response) => {
      const schema = req.user
        ? createServiceRequestAuthSchema
        : createServiceRequestGuestSchema;
      const validated = await zParse(schema, req);

      const quote = await this.quoteService.createServiceRequest(
        {
          ...validated.body,
          serviceType: QUOTE.SERVICE_TYPES.POST_CONSTRUCTION,
        },
        req.user?.userId
      );

      ApiResponse.created(res, quote, "Quote request submitted successfully");
    }
  );

  listAdminQuotes = asyncHandler(async (req: Request, res: Response) => {
    const searchFields = [
      "contactName",
      "firstName",
      "lastName",
      "email",
      "phoneNumber",
      "companyName",
      "serviceType",
      "status",
    ];

    if (req.query.page || req.query.limit) {
      const paginateOptions = PaginationHelper.parsePaginationParams(req.query);
      const filter = PaginationHelper.createSearchFilter(
        req.query,
        searchFields
      );
      const result = await this.quoteService.getPaginated(
        filter,
        paginateOptions
      );
      const response = PaginationHelper.formatResponse({
        ...result,
        data: result.data.map((quote) => this.quoteService.toResponse(quote)),
      });

      return ApiResponse.paginated(
        res,
        response.data,
        response.pagination,
        "Quotes fetched successfully"
      );
    }

    const filter = PaginationHelper.createSearchFilter(req.query, searchFields);
    const quotes = await this.quoteService.getAll(filter);
    const data = quotes.map((quote) => this.quoteService.toResponse(quote));
    ApiResponse.success(res, data, "Quotes fetched successfully");
  });

  listCleanerAssignedQuotes = asyncHandler(
    async (req: Request, res: Response) => {
      const searchFields = [
        "contactName",
        "firstName",
        "lastName",
        "email",
        "phoneNumber",
        "serviceType",
        "status",
      ];
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
      }

      const cleanerFilter = {
        assignedCleanerId: new Types.ObjectId(userId),
      };

      if (req.query.page || req.query.limit) {
        const paginateOptions = PaginationHelper.parsePaginationParams(
          req.query
        );
        const filter = {
          ...PaginationHelper.createSearchFilter(req.query, searchFields),
          ...cleanerFilter,
        };
        const result = await this.quoteService.getPaginated(
          filter,
          paginateOptions
        );
        const response = PaginationHelper.formatResponse({
          ...result,
          data: result.data.map((quote) => this.quoteService.toResponse(quote)),
        });

        return ApiResponse.paginated(
          res,
          response.data,
          response.pagination,
          "Assigned quotes fetched successfully"
        );
      }

      const filter = {
        ...PaginationHelper.createSearchFilter(req.query, searchFields),
        ...cleanerFilter,
      };
      const quotes = await this.quoteService.getAll(filter);
      const data = quotes.map((quote) => this.quoteService.toResponse(quote));
      ApiResponse.success(res, data, "Assigned quotes fetched successfully");
    }
  );

  getCleanerEarnings = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }

    const result = await this.quoteService.getCleanerEarnings(userId);
    ApiResponse.success(res, result, "Cleaner earnings fetched successfully");
  });

  getQuoteById = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }
    const validated = await zParse(quoteDetailSchema, req);
    const quote = await this.quoteService.getByIdForAccess(
      validated.params.quoteId,
      req.user
    );

    ApiResponse.success(res, quote, "Quote fetched successfully");
  });

  markArrived = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }

    const validated = await zParse(quoteDetailSchema, req);
    const quote = await this.quoteService.markArrived(
      validated.params.quoteId,
      userId
    );

    ApiResponse.success(res, quote, "Cleaning status updated successfully");
  });

  updateStatus = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(updateQuoteStatusSchema, req);
    const quote = await this.quoteService.updateStatus(
      validated.params.quoteId,
      validated.body
    );

    ApiResponse.success(res, quote, "Quote status updated successfully");
  });

  assignCleaner = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(assignQuoteCleanerSchema, req);
    const quote = await this.quoteService.assignCleaner(
      validated.params.quoteId,
      validated.body
    );

    ApiResponse.success(res, quote, "Cleaner assigned successfully");
  });
}
