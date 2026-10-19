import { createReadStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "./env";

export type Variant = "original" | "thumb" | "preview" | "playback";
export type ByteRange = { start: number; end: number };
export type StoredObject = { body: ReadableStream; size: number; length: number };

export interface Storage {
  put(key: string, filePath: string, contentType: string): Promise<void>;
  /** `size` is the full object size; `length` the bytes in `body` (differs for ranges). */
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
  size(key: string): Promise<number | null>;
  deletePrefix(prefix: string): Promise<void>;
}

const variantFile: Record<Variant, string> = {
  original: "original",
  thumb: "thumb.webp",
  preview: "preview.webp",
  playback: "playback.mp4",
};

export const mediaPrefix = (familyId: string, mediaId: string) => `f/${familyId}/m/${mediaId}/`;
export const mediaKey = (familyId: string, mediaId: string, variant: Variant) =>
  mediaPrefix(familyId, mediaId) + variantFile[variant];

class FsStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("storage key outside root");
    return full;
  }

  async put(key: string, filePath: string) {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(filePath, dest);
  }

  async get(key: string, range?: ByteRange) {
    const file = this.resolve(key);
    const info = await stat(file).catch(() => null);
    if (!info) return null;
    const stream = createReadStream(file, range);
    return {
      body: Readable.toWeb(stream) as ReadableStream,
      size: info.size,
      length: range ? range.end - range.start + 1 : info.size,
    };
  }

  async size(key: string) {
    return (await stat(this.resolve(key)).catch(() => null))?.size ?? null;
  }

  async deletePrefix(prefix: string) {
    await rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

class S3Storage implements Storage {
  private client: S3Client;
  constructor(private bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID ?? "", secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "" },
    });
  }

  async put(key: string, filePath: string, contentType: string) {
    const { size } = await stat(filePath);
    // PutObject accepts up to 5 GB, above the 2 GB video limit.
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: contentType,
    }));
  }

  async get(key: string, range?: ByteRange) {
    try {
      const res = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }));
      const total = res.ContentRange ? Number(res.ContentRange.split("/")[1]) : Number(res.ContentLength);
      return {
        body: res.Body!.transformToWebStream(),
        size: total,
        length: Number(res.ContentLength),
      };
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async size(key: string) {
    const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: key, MaxKeys: 1 }));
    const obj = res.Contents?.find((o) => o.Key === key);
    return obj ? Number(obj.Size) : null;
  }

  async deletePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const list = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

let instance: Storage | undefined;
export function storage(): Storage {
  if (!instance) {
    const e = env();
    if (e.STORAGE_DRIVER === "s3") {
      if (!e.S3_BUCKET || !e.S3_ENDPOINT) throw new Error("S3_BUCKET va S3_ENDPOINT sozlanmagan");
      instance = new S3Storage(e.S3_BUCKET);
    } else {
      instance = new FsStorage(path.resolve(e.STORAGE_DIR));
    }
  }
  return instance;
}
