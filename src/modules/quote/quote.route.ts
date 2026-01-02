import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { QuoteController } from "./quote.controller";

const router = Router();
const quoteController = new QuoteController();

router.post(
  "/intent",
  authMiddleware.optionalAuth,
  quoteController.createPaymentIntent
);

router.post(
  "/confirm",
  authMiddleware.optionalAuth,
  quoteController.confirmPayment
);

router.post(
  "/commercial",
  authMiddleware.optionalAuth,
  quoteController.createCommercialRequest
);

router.post(
  "/post-construction",
  authMiddleware.optionalAuth,
  quoteController.createPostConstructionRequest
);

router.get(
  "/admin",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  quoteController.listAdminQuotes
);

router.patch(
  "/:quoteId/status",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  quoteController.updateStatus
);

export default router;
