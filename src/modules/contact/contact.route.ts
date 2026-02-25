import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ContactController } from "./contact.controller";

const router = Router();
const contactController = new ContactController();

const publicContactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many contact requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/", publicContactLimiter, contactController.sendPublicContactMessage);

export default router;

