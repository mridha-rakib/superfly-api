// file: src/modules/base/base.service.ts

import type { BaseRepository } from "@/modules/base/base.repository";
import type { PaginateResult } from "@/ts/pagination.types";
import { NotFoundException } from "@/utils/app-error.utils";
import type { Document, PaginateOptions } from "mongoose";

export class BaseService<
  T extends Document<unknown, any, any, Record<string, any>, object>,
> {
  protected repo: BaseRepository<T>;
  protected searchFields: string[] = [];

  constructor(repo: BaseRepository<T>) {
    this.repo = repo;
  }

  async getAll(filter = {}, options = {}) {
    return this.repo.findAll(filter, options);
  }

  async getPaginated(
    filter: any = {},
    options: PaginateOptions
  ): Promise<PaginateResult<T>> {
    return this.repo.paginate(filter, options);
  }

  async getById(id: string) {
    return this.repo.findById(id);
  }

  async create(data: Partial<T>) {
    return this.repo.create(data);
  }

  async update(id: string, data: Partial<T>) {
    return this.repo.updateById(id, data);
  }

  async delete(id: string) {
    return this.repo.deleteById(id);
  }

  async exists(filter: any = {}): Promise<boolean> {
    const count = await this.repo.countDocuments(filter);

    return !count;
  }

  async findByIdAndThrow(
    id: string,
    errorMessage: string = "Resource not found"
  ) {
    const data = await this.repo.findById(id);

    if (!data) {
      throw new NotFoundException(errorMessage);
    }

    return data;
  }
}
