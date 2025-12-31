// file: src/modules/base/base.controller.ts

import type { NextFunction, Request, Response } from "express";
import type { Document } from "mongoose";

import type { BaseService } from "@/modules/base/base.service";
import { PaginationHelper } from "@/utils/pagination-helper";
import { ApiResponse } from "@/utils/response.utils";

export class BaseController<
  T extends Document<unknown, any, any, Record<string, any>, object>,
> {
  protected service: BaseService<T>;

  constructor(service: BaseService<T>) {
    this.service = service;
  }

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if pagination requested
      if (req.query.page || req.query.limit) {
        const paginateOptions = PaginationHelper.parsePaginationParams(
          req.query
        );
        const searchFields = (this.service as any).searchFields || [];
        const filter = PaginationHelper.createSearchFilter(
          req.query,
          searchFields
        );

        const result = await (this.service as any).getPaginated(
          filter,
          paginateOptions
        );
        const response = PaginationHelper.formatResponse(result);
        return ApiResponse.paginated(res, response.data, response.pagination);
      }

      const data = await this.service.getAll();
      ApiResponse.success(res, data);
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await this.service.getById(req.params.id);
      ApiResponse.success(res, data);
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await this.service.create(req.body);
      ApiResponse.created(res, data);
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await this.service.update(req.params.id, req.body);
      ApiResponse.success(res, data, "Resource updated successfully");
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.service.delete(req.params.id);
      ApiResponse.noContent(res);
    } catch (err) {
      next(err);
    }
  };
}
