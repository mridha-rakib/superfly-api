// file: src/utils/base-schema.utils.ts

import { mongoosePaginate } from "@/config/paginate.config";
import type { SchemaDefinition, SchemaOptions } from "mongoose";
import { Schema } from "mongoose";

/**
Base Schema Utility
Create a standard schema with timestamps and pagination
@param definition - Schema field definitions
@param options - Additional schema options
@returns Configured Mongoose Schema
*/

// file: src/utils/base-schema.utils.ts

export class BaseSchemaUtil {
  static createSchema<T>(
    definition: SchemaDefinition<T>,
    options: SchemaOptions<T> = {}
  ): Schema<T> {
    // Create schema with ONLY timestamps - no spread operator
    const schema = new Schema<T>(definition, {
      timestamps: true,
    });

    // Apply remaining options AFTER schema creation via schema.set()
    if (options && Object.keys(options).length > 0) {
      Object.keys(options).forEach((key) => {
        const value = (options as Record<string, any>)[key];
        if (value !== undefined) {
          schema.set(key as any, value);
        }
      });
    }

    // Add pagination plugin
    schema.plugin(mongoosePaginate);

    return schema;
  }

  static createIndexedSchema<T>(
    definition: SchemaDefinition<T>,
    indexConfig?: Record<string, any>,
    options: SchemaOptions<T> = {}
  ): Schema<T> {
    const schema = this.createSchema<T>(definition, options);

    if (indexConfig) {
      Object.entries(indexConfig).forEach(([fieldName, indexOptions]) => {
        schema.index({ [fieldName]: 1 }, indexOptions);
      });
    }

    return schema;
  }

  static auditFields() {
    return {
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
      deletedAt: Date,
      deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    } as const;
  }

  static softDeleteFields() {
    return {
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, index: true },
    } as const;
  }

  static statusField(enumValues: string[]) {
    return {
      status: {
        type: String,
        enum: enumValues,
        default: enumValues[0],
        index: true,
      },
    } as const;
  }

  static emailField(unique: boolean = true) {
    return {
      email: {
        type: String,
        required: true,
        unique,
        lowercase: true,
        trim: true,
        index: true,
      },
    } as const;
  }

  static passwordField() {
    return {
      password: { type: String, required: true, minlength: 8, select: false },
    } as const;
  }

  static phoneField() {
    return {
      phoneNumber: { type: String, sparse: true, trim: true },
    } as const;
  }

  static timestampFields() {
    return {
      createdAt: { type: Date, default: Date.now, index: true },
      updatedAt: { type: Date, default: Date.now },
    } as const;
  }

  static mergeDefinitions(
    ...definitions: Record<string, any>[]
  ): Record<string, any> {
    return definitions.reduce((acc, def) => ({ ...acc, ...def }), {});
  }
}
