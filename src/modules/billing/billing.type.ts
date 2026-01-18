export type BillingMode = "payment";
export type BillingStatus = "pending" | "paid" | "failed" | "canceled";

export type BillingLineItem = {
  key: string;
  label: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type ServiceSelection = Record<string, number | undefined>;

export type CheckoutSessionPayload = {
  services: ServiceSelection;
  mode?: BillingMode;
  recurring?: {
    interval: "day" | "week" | "month" | "year";
    intervalCount?: number;
  };
};

export type CheckoutSessionResponse = {
  url: string;
  sessionId: string;
  internalOrderId: string;
};
