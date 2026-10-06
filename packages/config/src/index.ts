/**
 * Constants that must agree across the mobile app, the API and validation.
 * Keep runtime secrets out of here: this package is bundled into the app.
 */

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Deployed environments must use real infrastructure (S3, push, mail). */
export const isDeployedEnv = (env: AppEnv): boolean => env === "staging" || env === "production";

const MB = 1024 * 1024;

export const LIMITS = {
  /** JSON request bodies (except sync push). */
  jsonBodyBytes: 2 * MB,
  /** One sync push batch from a device. */
  syncPushBytes: 5 * MB,
  /** A single photo original after on-device compression. */
  photoBytes: 50 * MB,
  /** Documents, plans and 3D model files. */
  documentBytes: 500 * MB,
} as const;

export const PHOTO = {
  /** Longest edge after on-device compression. */
  maxEdgePx: 2560,
  /** JPEG quality used on device (0–1). */
  jpegQuality: 0.8,
  /** Server-generated thumbnail bounding box. */
  thumbnailEdgePx: 400,
} as const;
