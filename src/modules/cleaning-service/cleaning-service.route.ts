import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { CleaningServiceController } from "./cleaning-service.controller";

const router = Router();
const controller = new CleaningServiceController();

router.get("/", controller.listActive);

router.get(
  "/admin",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN),
  controller.listAll
);

router.get(
  "/price-history",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN),
  controller.listPriceHistory
);

router.post(
  "/",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN),
  controller.createService
);

router.put(
  "/:serviceId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN),
  controller.updateService
);

router.patch(
  "/:serviceId/price",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN),
  controller.updatePrice
);

router.delete(
  "/:serviceId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN),
  controller.deleteService
);

export default router;
