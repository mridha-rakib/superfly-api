export type CleaningServiceCreatePayload = {
  name: string;
  price: number;
  description?: string;
  category?: string;
};

export type CleaningServiceUpdatePayload = {
  name?: string;
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
  category: string;
  description?: string;
  price: number;
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
