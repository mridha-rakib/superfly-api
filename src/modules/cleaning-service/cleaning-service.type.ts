export type CleaningServiceInputType = "BOOLEAN" | "QUANTITY";

export type CleaningServiceCreatePayload = {
  name: string;
  price: number;
  inputType?: CleaningServiceInputType;
  quantityLabel?: string;
  description?: string;
  category?: string;
};

export type CleaningServiceUpdatePayload = {
  name?: string;
  inputType?: CleaningServiceInputType;
  quantityLabel?: string;
  description?: string;
  category?: string;
  isActive?: boolean;
};

export type CleaningServicePriceUpdatePayload = {
  price: number;
};

export type CleaningServiceResponse = {
  _id: string;
  name: string;
  code: string;
  price: number;
  inputType: CleaningServiceInputType;
  quantityLabel?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PriceHistoryResponse = {
  _id: string;
  serviceId: string;
  serviceName: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;
  changedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
