import { BaseRepository } from "@/modules/base/base.repository";
import { Types } from "mongoose";
import type {
  IQuoteNotification,
  QuoteNotificationCreatePayload,
} from "./quote-notification.interface";
import { QuoteNotification } from "./quote-notification.model";

export class QuoteNotificationRepository extends BaseRepository<IQuoteNotification> {
  constructor() {
    super(QuoteNotification);
  }

  async createOnce(
    payload: QuoteNotificationCreatePayload
  ): Promise<IQuoteNotification> {
    const eventKey = payload.eventKey?.trim() || "default";

    try {
      return await this.model
        .findOneAndUpdate(
          { quoteId: payload.quoteId, event: payload.event, eventKey },
          { $setOnInsert: { ...payload, eventKey } },
          { new: true, upsert: true }
        )
        .exec();
    } catch (error) {
      const isDuplicate =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: number }).code === 11000;

      if (isDuplicate) {
        const existing = await this.model
          .findOne({ quoteId: payload.quoteId, event: payload.event, eventKey })
          .exec();
        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  async listAdminNotifications(
    params: { page: number; limit: number; onlyUnread?: boolean } = {
      page: 1,
      limit: 20,
    },
  ): Promise<{
    items: IQuoteNotification[];
    totalItems: number;
    unreadCount: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));
    const filter: Record<string, any> = {};

    if (params.onlyUnread) {
      filter.isRead = { $ne: true };
    }

    const [items, totalItems, unreadCount] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
      this.model.countDocuments({ isRead: { $ne: true } }).exec(),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    return {
      items,
      totalItems,
      unreadCount,
      page,
      limit,
      totalPages,
    };
  }

  async markAsRead(notificationId: string): Promise<IQuoteNotification | null> {
    if (!Types.ObjectId.isValid(notificationId)) {
      return null;
    }

    return this.model
      .findByIdAndUpdate(
        notificationId,
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();
  }

  async markAllAsRead(): Promise<number> {
    const result = await this.model
      .updateMany(
        { isRead: { $ne: true } },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
      )
      .exec();

    return result.modifiedCount || 0;
  }
}
