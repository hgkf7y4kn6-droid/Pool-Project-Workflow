import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * All runtime configuration comes from environment variables, validated at
 * boot. Secrets are injected by the platform's secret manager in staging and
 * production — never committed, never shipped to the mobile app.
 */
const envSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
    APP_URL: z.string().default("poolpm://"),
    CORS_ORIGINS: z.string().default("http://localhost:8081,http://localhost:19006"),

    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().default(10),
    REDIS_URL: z.string().optional(),

    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_ISSUER: z.string().default("pool-pm-api"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
    /** 32-byte key (base64) for encrypting MFA secrets and integration credentials. */
    DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded",
    }),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default(".storage"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default("auto"),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().default(900),

    WEATHER_PROVIDER: z.enum(["open-meteo", "none"]).default("open-meteo"),
    WEATHER_API_URL: z.string().url().default("https://api.open-meteo.com/v1/forecast"),

    PUSH_PROVIDER: z.enum(["expo", "log"]).default("log"),
    EXPO_ACCESS_TOKEN: z.string().optional(),

    MAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
    MAIL_FROM: z.string().default("Pool PM <no-reply@example.com>"),
    RESEND_API_KEY: z.string().optional(),

    GOOGLE_OAUTH_CLIENT_IDS: z.string().optional(),
    APPLE_OAUTH_CLIENT_IDS: z.string().optional(),

    DESIGN_PROVIDER_HTTP_URL: z.string().url().optional(),
    DESIGN_PROVIDER_HTTP_TOKEN: z.string().optional(),

    AI_PROVIDER: z.enum(["anthropic", "none"]).default("none"),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default("claude-opus-5-5"),

    RATE_LIMIT_MAX: z.coerce.number().int().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(20),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3" && !env.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "S3_BUCKET is required for the s3 driver" });
    }
    if (env.PUSH_PROVIDER === "expo" && env.APP_ENV === "production" && !env.EXPO_ACCESS_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["EXPO_ACCESS_TOKEN"], message: "EXPO_ACCESS_TOKEN is required in production" });
    }
    if (env.MAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "RESEND_API_KEY is required for resend" });
    }
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "ANTHROPIC_API_KEY is required for anthropic" });
    }
    if ((env.APP_ENV === "production" || env.APP_ENV === "staging") && env.STORAGE_DRIVER === "local") {
      ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "Use object storage (s3) outside development" });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
