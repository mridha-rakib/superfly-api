import { MESSAGES } from "@/constants/app.constants";
import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { UnauthorizedException } from "@/utils/app-error.utils";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import type { Request, Response } from "express";
import {
  getLegalContentSchema,
  upsertLegalContentSchema,
} from "./legal-content.schema";
import { LegalContentService } from "./legal-content.service";

export class LegalContentController {
  private service: LegalContentService;

  constructor() {
    this.service = new LegalContentService();
  }

  getContent = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(getLegalContentSchema, req);
    const result = await this.service.getContent(validated.params.slug);
    ApiResponse.success(res, result, "Legal content fetched successfully");
  });

  updateContent = asyncHandler(async (req: Request, res: Response) => {
    const validated = await zParse(upsertLegalContentSchema, req);
    const adminId = req.user?.userId;
    if (!adminId) {
      throw new UnauthorizedException(MESSAGES.AUTH.UNAUTHORIZED_ACCESS);
    }
    const result = await this.service.updateContent(
      validated.params.slug,
      validated.body,
      adminId
    );
    ApiResponse.success(res, result, "Legal content updated successfully");
  });
}
