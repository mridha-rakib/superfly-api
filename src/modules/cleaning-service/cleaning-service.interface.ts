import type { Document, Types } from "mongoose";

export type CleaningServiceInputType = "BOOLEAN" | "QUANTITY";

export interface ICleaningService extends Document {
  _id: Types.ObjectId;
  name: string;
  nameLower: string;
  code: string;
  price: number;
  inputType: CleaningServiceInputType;
  quantityLabel?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICleaningServicePriceHistory extends Document {
  _id: Types.ObjectId;
  serviceId: Types.ObjectId | string;
  serviceName: string;
  oldPrice: number;
  newPrice: number;
  changedBy: Types.ObjectId | string;
  changedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
