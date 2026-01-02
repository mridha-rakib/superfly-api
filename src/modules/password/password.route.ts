// file: src/modules/password-reset/password-reset.route.ts

import { Router } from "express";
import { PasswordResetController } from "./password.controller";

const router = Router();
const controller = new PasswordResetController();

router.post("/forgot-password", controller.requestPasswordReset);

router.post("/verify-password-otp", controller.verifyPasswordOTP);

router.post("/reset-password", controller.resetPassword);

router.post("/resend-password-otp", controller.resendPasswordOTP);

export default router;
