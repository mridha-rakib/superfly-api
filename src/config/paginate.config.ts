// file: src\config\paginate.config.ts
import type { PaginateOptions } from "mongoose";

import mongoosePaginate from "mongoose-paginate-v2";

import type { CustomLabels } from "@/ts/pagination.types";

const customLabels: CustomLabels = {
  totalDocs: "totalItems",
  docs: "data",
  limit: "itemsPerPage",
  totalPages: "pageCount",
  page: "currentPage",
  nextPage: "nextPage",
  prevPage: "prevPage",
  hasPrevPage: "hasPrev",
  hasNextPage: "hasNext",
  pagingCounter: "slNo",
  meta: "pagination",
};

export const defaultPaginateOptions: PaginateOptions = {
  page: 1,
  limit: 10,
  lean: true,
  leanWithId: true,
  sort: { createdAt: -1 },
  select: "",
  populate: "",
  customLabels,
  pagination: true,
  useEstimatedCount: true,
  allowDiskUse: true,
};

export const PAGINATION_THRESHOLDS = {
  CURSOR_PAGINATION_AFTER_PAGE: 100,
  MAX_SEARCH_RESULTS: 10000,
  SLOW_QUERY_THRESHOLD_MS: 1000,
  MEMORY_WARNING_LIMIT: 1000,
} as const;

mongoosePaginate.paginate.options = defaultPaginateOptions;
export { mongoosePaginate };
