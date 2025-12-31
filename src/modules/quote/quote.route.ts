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

export default router;
