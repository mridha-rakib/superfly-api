// file: src/utils/response.utils.ts

import { HTTPSTATUS } from "@/config/http.config";
import { Response } from "express";

export class ApiResponse {
  static success<T = any>(
    res: Response,
    data: T,
    message: string = "Success",
    statusCode: number = HTTPSTATUS.OK
  ) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static paginated<T = any>(
    res: Response,
    data: T[],
    pagination: any,
    message: string = "Success",
    statusCode: number = HTTPSTATUS.OK
  ) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      pagination,
      timestamp: new Date().toISOString(),
    });
  }

  static created<T = any>(
    res: Response,
    data: T,
    message: string = "Resource created successfully"
  ) {
    return this.success(res, data, message, HTTPSTATUS.CREATED);
  }

  static noContent(res: Response) {
    return res.status(HTTPSTATUS.NO_CONTENT).send();
  }
}
