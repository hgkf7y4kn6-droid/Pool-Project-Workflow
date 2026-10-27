import { StorageClient } from "@supabase/storage-js";
import type { SignedUpload, StorageProvider } from "./types";

export interface SupabaseStorageConfig {
  /** Project URL, e.g. https://abcd1234.supabase.co */
  url: string;
  /** Server-only secret key (sb_secret_… or the legacy service_role key). Never ship it to the app. */
  secretKey: string;
  bucket: string;
  fetch?: typeof fetch;
}

/** Supabase signed upload URLs have a fixed lifetime set by Supabase. */
const SUPABASE_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

/**
 * Supabase Storage through its native API. The bucket stays private: devices
 * upload with single-use signed upload URLs and download with signed URLs.
 */
export class SupabaseStorage implements StorageProvider {
  readonly driver = "supabase";
  private readonly client: StorageClient;

  constructor(private readonly config: SupabaseStorageConfig) {
    this.client = new StorageClient(
      `${config.url.replace(/\/$/, "")}/storage/v1`,
      { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}` },
      config.fetch,
    );
  }

  private get bucket() {
    return this.client.from(this.config.bucket);
  }

  async createUploadUrl(key: string, options: { contentType: string; expiresInSeconds: number }): Promise<SignedUpload> {
    // upsert: a retried offline upload may re-register the same object.
    const { data, error } = await this.bucket.createSignedUploadUrl(key, { upsert: true });
    if (error || !data) throw new Error(`Supabase: could not sign upload for ${key}: ${error?.message ?? "no data"}`);
    const ttl = Math.min(options.expiresInSeconds, SUPABASE_UPLOAD_TTL_SECONDS);
    return {
      url: data.signedUrl,
      method: "PUT",
      headers: { "content-type": options.contentType, "x-upsert": "true" },
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
  }

  async createDownloadUrl(key: string, options: { expiresInSeconds: number; fileName?: string }): Promise<string> {
    const { data, error } = await this.bucket.createSignedUrl(key, options.expiresInSeconds, options.fileName ? { download: options.fileName } : undefined);
    if (error || !data) throw new Error(`Supabase: could not sign download for ${key}: ${error?.message ?? "no data"}`);
    return data.signedUrl;
  }

  async head(key: string): Promise<{ size: number; contentType: string | null } | null> {
    const { data, error } = await this.bucket.info(key);
    if (error || !data) return null;
    const info = data as { size?: number; contentType?: string | null; metadata?: { size?: number; mimetype?: string } };
    return { size: info.size ?? info.metadata?.size ?? 0, contentType: info.contentType ?? info.metadata?.mimetype ?? null };
  }

  async getObject(key: string): Promise<Buffer> {
    const { data, error } = await this.bucket.download(key);
    if (error || !data) throw new Error(`Supabase: could not download ${key}: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const { error } = await this.bucket.upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`Supabase: could not upload ${key}: ${error.message}`);
  }

  async deleteObject(key: string): Promise<void> {
    const { error } = await this.bucket.remove([key]);
    if (error) throw new Error(`Supabase: could not delete ${key}: ${error.message}`);
  }

  /** Creates the private bucket if it doesn't exist (used by `npm run supabase:setup`). */
  async ensureBucket(options: { fileSizeLimitBytes: number }): Promise<"created" | "exists"> {
    const existing = await this.client.getBucket(this.config.bucket);
    if (existing.data) return "exists";
    const { error } = await this.client.createBucket(this.config.bucket, { public: false, fileSizeLimit: options.fileSizeLimitBytes });
    if (error) throw new Error(`Supabase: could not create bucket ${this.config.bucket}: ${error.message}`);
    return "created";
  }
}
