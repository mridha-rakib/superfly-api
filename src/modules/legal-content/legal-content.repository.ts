import { BaseRepository } from "@/modules/base/base.repository";
import type { ILegalContent } from "./legal-content.interface";
import { LegalContent } from "./legal-content.model";
import type { LegalContentSlug } from "./legal-content.type";

export class LegalContentRepository extends BaseRepository<ILegalContent> {
  constructor() {
    super(LegalContent);
  }

  async findBySlug(slug: LegalContentSlug): Promise<ILegalContent | null> {
    return this.model.findOne({ slug }).exec();
  }
}
