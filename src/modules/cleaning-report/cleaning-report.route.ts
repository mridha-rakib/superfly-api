import { ROLES } from "@/constants/app.constants";
import upload from "@/config/multer.config";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { CleaningReportController } from "./cleaning-report.controller";

const router = Router();
const controller = new CleaningReportController();

router.post(
  "/quotes/:quoteId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.CLEANER),
  upload.fields([
    { name: "beforePhotos", maxCount: 10 },
    { name: "afterPhotos", maxCount: 10 },
  ]),
  controller.createReport
);

router.get(
  "/admin",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  controller.listAdminReports
);

router.get(
  "/:reportId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  controller.getReportById
);

router.patch(
  "/:reportId/approve",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  controller.approveReport
);

export default router;
