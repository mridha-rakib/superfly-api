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

router.get(
  "/payment-status",
  authMiddleware.optionalAuth,
  quoteController.getPaymentStatus
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

router.patch(
  "/:quoteId/assign-cleaner",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  quoteController.assignCleaner
);

router.get(
  "/cleaner/assigned",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.CLEANER),
  quoteController.listCleanerAssignedQuotes
);

router.get(
  "/cleaner/earnings",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.CLEANER),
  quoteController.getCleanerEarnings
);

router.patch(
  "/:quoteId/arrived",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.CLIENT),
  quoteController.markArrived
);

router.get(
  "/:quoteId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.CLEANER,
    ROLES.CLIENT
  ),
  quoteController.getQuoteById
);

export default router;
