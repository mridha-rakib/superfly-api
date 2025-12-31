import { QUOTE } from "@/constants/app.constants";
import type { ICleaningService } from "../cleaning-service/cleaning-service.interface";
import type { QuoteServiceItem, QuoteServiceSelection } from "./quote.type";

export class QuotePricingService {
  calculate(
    selections: QuoteServiceSelection,
    services: ICleaningService[]
  ): {
    items: QuoteServiceItem[];
    total: number;
    currency: string;
  } {
    const items: QuoteServiceItem[] = [];
    let total = 0;

    for (const service of services) {
      const quantity = this.normalizeQuantity(selections[service.code]);
      const subtotal = service.price * quantity;

      items.push({
        key: service.code,
        label: service.name,
        unitPrice: service.price,
        quantity,
        subtotal,
      });

      total += subtotal;
    }

    return {
      items,
      total,
      currency: QUOTE.CURRENCY,
    };
  }

  private normalizeQuantity(value: number | undefined): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return 0;
    }

    if (value <= 0) {
      return 0;
    }

    return Math.floor(value);
  }
}
