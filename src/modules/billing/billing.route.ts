import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { BillingController } from "./billing.controller";

const router = Router();
const controller = new BillingController();

router.post(
  "/checkout-session",
  authMiddleware.verifyToken,
  controller.createCheckoutSession,
);

export default router;
