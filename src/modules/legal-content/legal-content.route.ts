import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { LegalContentController } from "./legal-content.controller";

const router = Router();
const controller = new LegalContentController();

router.get("/:slug", controller.getContent);

router.put(
  "/:slug",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  controller.updateContent
);

export default router;
