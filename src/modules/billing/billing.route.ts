import { authMiddleware } from "@/middlewares/auth.middleware";
import { paymentLimiter } from "@/middlewares/rate-limit.middleware";
import { Router } from "express";
import { BillingController } from "./billing.controller";

const router = Router();
const controller = new BillingController();

router.post(
  "/checkout-session",
  paymentLimiter,
  authMiddleware.verifyToken,
  controller.createCheckoutSession,
);

export default router;
