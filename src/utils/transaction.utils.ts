// file: src/utils/transaction.utils.ts

import type { ClientSession } from "mongoose";
import mongoose from "mongoose";

export class TransactionHelper {
  static async withTransaction<T>(
    callback: (session: ClientSession) => Promise<T>
  ): Promise<T> {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await callback(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
