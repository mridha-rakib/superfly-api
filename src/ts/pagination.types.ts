// file: src/ts/pagination.types.ts
import type { Request } from "express";
import type {
  Document,
  PaginateModel as MongoosePaginateModel,
} from "mongoose";

export interface CustomLabels {
  totalDocs?: string;
  docs?: string;
  limit?: string;
  page?: string;
  nextPage?: string;
  prevPage?: string;
  totalPages?: string;
  pagingCounter?: string;
  hasPrevPage?: string;
  hasNextPage?: string;
  meta?: string;
}

export interface PaginateResult<T> {
  data: T[];
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  pageCount: number;
  nextPage: number | null;
  prevPage: number | null;
  slNo: number;
  hasPrev: boolean;
  hasNext: boolean;
  meta?: Record<string, any>;
}

export interface PaginationQuery {
  page?: string | number;
  limit?: string | number;
  sort?: string;
  select?: string;
  populate?: string;
  search?: string;
  searchType?: "regex" | "fulltext" | "phrase";
  searchFields?: string[];
  roleFilter?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  filters?: Record<string, any>;
  [key: string]: any;
}

export interface PaginatedRequest extends Request {
  query: PaginationQuery;
}

// Enhanced: More comprehensive response type
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
    hasNext: boolean;
    hasPrev: boolean;
    nextPage: number | null;
    prevPage: number | null;
    slNo: number;
  };
  meta?: Record<string, any>;
  error?: string;
}

export type CustomPaginateModel<T extends Document> = MongoosePaginateModel<T>;

// Additional utility types
export interface SearchableFields {
  [key: string]: string[];
}

export interface FilterOptions {
  searchFields?: string[];
  additionalFilters?: Record<string, any>;
  defaultSort?: Record<string, number | "asc" | "desc">;
}
