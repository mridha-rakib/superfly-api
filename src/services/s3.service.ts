import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/env";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export type StorageUploadInput = {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
};

export type StorageUploadResult = {
  key: string;
  url: string;
};

export class S3Service {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private endpoint?: string;

  constructor() {
    this.bucket = env.AWS_S3_BUCKET;
    this.region = env.AWS_REGION;
    this.endpoint = env.AWS_S3_ENDPOINT?.replace(/\/+$/, "");
    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  async uploadFile(
    file: StorageUploadInput,
    options: { prefix: string }
  ): Promise<StorageUploadResult> {
    const key = this.buildKey(options.prefix, file.originalName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimeType,
      })
    );

    return {
      key,
      url: this.buildPublicUrl(key),
    };
  }

  async uploadFiles(
    files: StorageUploadInput[],
    options: { prefix: string }
  ): Promise<StorageUploadResult[]> {
    const uploads = files.map((file) => this.uploadFile(file, options));
    return Promise.all(uploads);
  }

  private buildKey(prefix: string, originalName: string): string {
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
    const extension = path.extname(originalName).toLowerCase();
    const safeExtension =
      extension && extension.length <= 10 ? extension : "";
    return `${normalizedPrefix}/${uuidv4()}${safeExtension}`;
  }

  private buildPublicUrl(key: string): string {
    if (this.endpoint) {
      return `${this.endpoint}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}

export const s3Service = new S3Service();
