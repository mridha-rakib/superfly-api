import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { ReviewController } from "./review.controller";

const router = Router();
const controller = new ReviewController();

router.get("/", authMiddleware.verifyToken, controller.listReviews);
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
