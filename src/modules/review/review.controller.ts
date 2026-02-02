import { ROLES } from "@/constants/app.constants";
import { ApiResponse } from "@/utils/response.utils";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { zParse } from "@/utils/validators.utils";
import { ReviewService } from "./review.service";
import { createReviewSchema } from "./review.schema";

export class ReviewController {
  private reviewService: ReviewService;

  constructor() {
    this.reviewService = new ReviewService();
  }

  createReview = asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }
    const validated = await zParse(createReviewSchema, req);
    const review = await this.reviewService.createReview(
      userId,
      validated.body,
    );
    ApiResponse.created(res, review, "Review submitted successfully");
  });

  listReviews = asyncHandler(async (req, res) => {
    const reviews = await this.reviewService.listAll();
    ApiResponse.success(res, reviews, "Reviews fetched successfully");
  });

  listClientReviews = asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }
    const reviews = await this.reviewService.listForClient(userId);
    ApiResponse.success(res, reviews, "Client reviews fetched successfully");
  });
}
