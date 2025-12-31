// file: src/middlewares/async-handler.middleware.ts

import type { NextFunction, Request, Response } from "express";

type AsyncControllerType = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

export function asyncHandler(
  controller: AsyncControllerType
): AsyncControllerType {
  return async (req, res, next) => {
    try {
      await controller(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}
