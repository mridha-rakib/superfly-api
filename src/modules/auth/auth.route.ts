// file: src/modules/auth/auth.route.ts

import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import passwordResetRoutes from "../password/password.route";
import { AuthController } from "./auth.controller";

const router = Router();
const authController = new AuthController();

router.post("/register", authController.register);

router.post("/login", authController.login);

router.post("/verify-email", authController.verifyEmail);

router.post("/resend-verification", authController.resendVerificationCode);

router.post("/verify-otp", authController.verifyOTP);

router.post("/refresh-token", authController.refreshToken);

router.use("/", passwordResetRoutes);

router.put(
  "/change-password",
  authMiddleware.verifyToken,
  authController.changePassword
);

router.post("/logout", authMiddleware.verifyToken, authController.logout);

export default router;
