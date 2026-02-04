import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { DashboardController } from "./dashboard.controller";

const router = Router();
const dashboardController = new DashboardController();

router.get(
  "/overview",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  dashboardController.getOverview
);

export default router;
