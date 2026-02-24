import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { ReviewController } from "./review.controller";

const router = Router();
const controller = new ReviewController();

// Public reviews page: guests and logged-in clients can view reviews
router.get("/", controller.listReviews);
router.get(
  "/client",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.CLIENT),
  controller.listClientReviews,
);
router.post(
  "/",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.CLIENT),
  controller.createReview,
);

export default router;
