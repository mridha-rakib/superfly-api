import type { Document, Types } from "mongoose";

export interface ICleaningService extends Document {
  _id: Types.ObjectId;
  name: string;
  nameLower: string;
  code: string;
  price: number;
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
