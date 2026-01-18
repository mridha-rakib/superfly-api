import { Router } from "express";
import { BillingController } from "./billing.controller";

const router = Router();
const controller = new BillingController();

router.post("/", controller.handleWebhook);

export default router;
