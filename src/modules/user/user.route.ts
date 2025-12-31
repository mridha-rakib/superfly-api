// file: src/modules/user/user.route.ts

import { authMiddleware } from "@/middlewares/auth.middleware";
import { Router } from "express";
import { UserController } from "./user.controller";

const router = Router();
const userController = new UserController();

router.get("/profile", authMiddleware.verifyToken, userController.getProfile);

export default router;
