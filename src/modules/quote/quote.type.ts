export type QuoteServiceSelection = Record<string, number | undefined>;

export type QuoteServiceItem = {
  key: string;
  label: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type QuoteCreatePayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  serviceDate: string;
  notes?: string;
  services: QuoteServiceSelection;
};

export type QuoteResponse = {
  _id: string;
  userId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  serviceDate: string;
  notes?: string;
  services: QuoteServiceItem[];
  totalPrice: number;
  currency: string;
  paymentIntentId: string;
  paymentAmount: number;
  paymentStatus: "paid";
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type QuotePaymentIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
};
