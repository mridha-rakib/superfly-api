// file: src/modules/user/user.controller.ts

import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { ApiResponse } from "@/utils/response.utils";
import type { Request, Response } from "express";
import { UserService } from "./user.service";

export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  getProfile = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const profile = await this.userService.getProfile(userId);
    ApiResponse.success(res, profile, "Profile fetched successfully");
  });
}
