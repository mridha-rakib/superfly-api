// file: src/modules/base/base.repository.ts

import { PaginateResult } from "@/ts/pagination.types";
import type { Document, FilterQuery, Model, PaginateOptions } from "mongoose";

export class BaseRepository<
  T extends Document<unknown, any, any, Record<string, any>, object>,
> {
  protected model: Model<T>;

  constructor(model: Model<T>) {
    this.model = model;
  }

  async findById(id: string): Promise<T | null> {
    return this.model.findById(id).exec();
  }

  async findOne(filter = {}): Promise<T | null> {
    return this.model.findOne(filter).exec();
  }
  async create(data: Partial<T>): Promise<T> {
    return this.model.create(data);
  }

  async updateById(id: string, data: Partial<T>): Promise<T | null> {
    return this.model.findByIdAndUpdate(id, data, { new: true }).exec();
  }

  async deleteById(id: string): Promise<T | null> {
    return this.model.findByIdAndDelete(id).exec();
  }
  async paginate(
    query: any = {},
    options: PaginateOptions
  ): Promise<PaginateResult<T>> {
    return (this.model as any).paginate(query, options);
  }

  async countDocuments(filter: any = {}): Promise<number> {
    return this.model.countDocuments(filter);
  }

  async softDelete(id: string): Promise<T | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { deletedAt: new Date(), isDeleted: true },
        { new: true }
      )
      .exec();
  }

  async restore(id: string): Promise<T | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { deletedAt: null, isDeleted: false },
        { new: true }
      )
      .exec();
  }

  // Auto-exclude soft deleted in findAll
  async findAll(filter = {}, options = {}): Promise<T[]> {
    const finalFilter = { ...filter, isDeleted: { $ne: true } };
    return this.model.find(finalFilter, null, options).lean() as unknown as T[];
  }

  /**
   * Find documents matching query
   */
  async find(
    query: FilterQuery<T> = {},
    options: {
      skip?: number;
      limit?: number;
      sort?: string | { [key: string]: 1 | -1 };
    } = {}
  ): Promise<T[]> {
    let queryBuilder = this.model.find(query);

    if (options.skip) {
      queryBuilder = queryBuilder.skip(options.skip);
    }

    if (options.limit) {
      queryBuilder = queryBuilder.limit(options.limit);
    }

    if (options.sort) {
      queryBuilder = queryBuilder.sort(options.sort);
    }

    return queryBuilder.exec();
  }

  /**
   * Check if document exists
   */
  async exists(query: FilterQuery<T>): Promise<boolean> {
    const count = await this.model.countDocuments(query).exec();
    return count > 0;
  }
}
