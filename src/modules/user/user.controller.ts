// file: src/modules/user/user.controller.ts

import { MESSAGES } from "@/constants/app.constants";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import {
  cleanerIdSchema,
  createCleanerSchema,
  listCleanersSchema,
  updateCleanerSchema,
  updateProfileSchema,
} from "./user.schema";
import { UserService } from "./user.service";

export class UserController {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  listCleaners = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(listCleanersSchema, req);
    const result = await this.userService.listCleaners(validated.query);
    ApiResponse.paginated(
      res,
      result.data,
      result.pagination,
      "Cleaners fetched successfully"
    );
  });

  getCleaner = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(cleanerIdSchema, req);
    const cleaner = await this.userService.getCleanerById(
      validated.params.cleanerId
    );
    ApiResponse.success(res, cleaner, "Cleaner fetched successfully");
  });

  getProfile = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }
    const profile = await this.userService.getProfile(userId);
    ApiResponse.success(res, profile, "Profile fetched successfully");
  });

  updateProfile = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }

    const validated = await zParse(updateProfileSchema, req);
    const profile = await this.userService.updateProfile(
      userId,
      validated.body
    );

    ApiResponse.success(res, profile, "Profile updated successfully");
  });

  createCleaner = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(createCleanerSchema, req);
    const result = await this.userService.createCleaner(validated.body);
    const message = result.emailSent
      ? "Cleaner created successfully"
      : "Cleaner created, but email delivery failed";
    ApiResponse.created(res, result, message);
  });

  updateCleaner = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(updateCleanerSchema, req);
    const cleaner = await this.userService.updateCleaner(
      validated.params.cleanerId,
      validated.body
    );
    ApiResponse.success(res, cleaner, "Cleaner updated successfully");
  });

  deleteCleaner = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(cleanerIdSchema, req);
    await this.userService.deleteCleaner(validated.params.cleanerId);
    ApiResponse.success(res, { message: "Cleaner deleted successfully" });
  });
}
