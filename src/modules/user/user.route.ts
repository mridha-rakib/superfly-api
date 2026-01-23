// file: src/modules/user/user.route.ts

import { ROLES } from "@/constants/app.constants";
import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { UserController } from "./user.controller";

const router = Router();
const userController = new UserController();

router.get("/profile", authMiddleware.verifyToken, userController.getProfile);

router.post(
  "/cleaners",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  userController.createCleaner
);

router.get(
  "/cleaners",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  userController.listCleaners
);

router.get(
  "/cleaners/:cleanerId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  userController.getCleaner
);

router.put(
  "/cleaners/:cleanerId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  userController.updateCleaner
);

router.delete(
  "/cleaners/:cleanerId",
  authMiddleware.verifyToken,
  authMiddleware.authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  userController.deleteCleaner
);

export default router;
