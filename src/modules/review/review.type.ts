export type ReviewResponse = {
  _id: string;
  quoteId: string;
  clientId: string;
  rating: number;
  comment?: string;
  clientName?: string;
  createdAt: Date;
  updatedAt: Date;
};
