// file: src/modules/user/user.controller.ts

import { MESSAGES } from "@/constants/app.constants";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { ApiResponse } from "@/utils/response.utils";
import type { Request, Response } from "express";
import { UserService } from "./user.service";

export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  getProfile = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }
    const profile = await this.userService.getProfile(userId);
    ApiResponse.success(res, profile, "Profile fetched successfully");
  });
}
