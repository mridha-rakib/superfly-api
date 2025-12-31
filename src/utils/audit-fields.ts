// file: src/utils/audit-fields.ts

import { Schema } from "mongoose";

export function addAuditFields(schema: Schema) {
  schema.add({
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  });
}

// Usage in schema:
// addAuditFields(schema);
