import { QUOTE } from "@/constants/app.constants";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@/utils/app-error.utils";
import { QuoteRepository } from "../quote/quote.repository";
import { ReviewRepository } from "./review.repository";
import type { IReview } from "./review.interface";
import type { ReviewResponse } from "./review.type";

type CreateReviewPayload = {
  quoteId: string;
  rating: number;
  comment?: string;
  clientName?: string;
};

export class ReviewService {
  private reviewRepository: ReviewRepository;
  private quoteRepository: QuoteRepository;

  constructor() {
    this.reviewRepository = new ReviewRepository();
    this.quoteRepository = new QuoteRepository();
  }

  async createReview(
    clientId: string,
    payload: CreateReviewPayload,
  ): Promise<ReviewResponse> {
    const quote = await this.quoteRepository.findById(payload.quoteId);
    if (!quote) {
      throw new NotFoundException("Quote not found");
    }

    if (!quote.userId || quote.userId.toString() !== clientId) {
      throw new ForbiddenException("Quote does not belong to the client");
    }

    if (
      quote.status !== QUOTE.STATUSES.COMPLETED &&
      quote.status !== QUOTE.STATUSES.REVIEWED
    ) {
      throw new BadRequestException(
        "Reviews can only be created for completed quotes",
      );
    }

    const existing = await this.reviewRepository.findByQuoteId(payload.quoteId);
    if (existing) {
      throw new ConflictException("Review already submitted for this quote");
    }

    const review = await this.reviewRepository.create({
      quoteId: quote._id,
      clientId,
      rating: payload.rating,
      comment: payload.comment?.trim(),
      clientName: payload.clientName?.trim(),
    });

    await this.quoteRepository.updateById(quote._id.toString(), {
      status: QUOTE.STATUSES.REVIEWED,
    });

    return this.toResponse(review);
  }

  async listAll(): Promise<ReviewResponse[]> {
    const reviews = await this.reviewRepository.findMany();
    return reviews.map((review) => this.toResponse(review));
  }

  async listForClient(clientId: string): Promise<ReviewResponse[]> {
    const reviews = await this.reviewRepository.findMany({ clientId });
    return reviews.map((review) => this.toResponse(review));
  }

  private toResponse(review: IReview): ReviewResponse {
    return {
      _id: String(review._id),
      quoteId: review.quoteId?.toString?.() ?? "",
      clientId: review.clientId?.toString?.() ?? "",
      rating: review.rating,
      comment: review.comment,
      clientName: review.clientName,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}
