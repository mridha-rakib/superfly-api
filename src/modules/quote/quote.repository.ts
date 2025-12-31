import { BaseRepository } from "@/modules/base/base.repository";
import type { IQuote } from "./quote.interface";
import { Quote } from "./quote.model";

export class QuoteRepository extends BaseRepository<IQuote> {
  constructor() {
    super(Quote);
  }
}
