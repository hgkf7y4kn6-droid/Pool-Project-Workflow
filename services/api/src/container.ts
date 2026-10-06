import { createDb } from "@pool/database";
import pino from "pino";
import type { Env } from "./config/env";
import type { Deps } from "./context";
import { AnthropicAiProvider } from "./adapters/ai/anthropic";
import { HttpDesignProvider } from "./adapters/design/http";
import { DesignProviderRegistry } from "./adapters/design/registry";
import { BullJobQueue, InlineJobQueue, JOB_NAMES } from "./adapters/jobs";
import { ConsoleMailer, ResendMailer } from "./adapters/mail";
import { OAuthVerifier } from "./adapters/oauth";
import { ExpoPushProvider, LogPushProvider } from "./adapters/push";
import { InMemoryEventBus, RedisEventBus } from "./adapters/realtime";
import { LocalStorage } from "./adapters/storage/local";
import { S3Storage } from "./adapters/storage/s3";
import { NoWeatherProvider, OpenMeteoProvider } from "./adapters/weather/open-meteo";
import { jobHandlers } from "./jobs";

export interface Container {
  deps: Deps;
  close(): Promise<void>;
}

/**
 * Wire adapters from configuration. Every third-party service sits behind an
 * interface, so swapping a vendor is a change here, not in business logic.
 */
export function createContainer(env: Env, overrides: Partial<Deps> = {}): Container {
  const log =
    overrides.log ??
    pino({
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "*.password", "*.refreshToken", "*.accessToken", "*.token"],
    });
  const { db, pool } = createDb({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX, ssl: env.DATABASE_SSL });

  const storage =
    env.STORAGE_DRIVER === "s3"
      ? new S3Storage({
          bucket: env.S3_BUCKET!,
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new LocalStorage(env.STORAGE_LOCAL_DIR, env.PUBLIC_API_URL, env.JWT_SECRET);

  const designs = new DesignProviderRegistry();
  if (env.DESIGN_PROVIDER_HTTP_URL) designs.register(new HttpDesignProvider(env.DESIGN_PROVIDER_HTTP_URL, env.DESIGN_PROVIDER_HTTP_TOKEN));

  const inlineJobs = env.REDIS_URL ? null : new InlineJobQueue((msg, err) => log.warn({ err }, msg));
  const deps: Deps = {
    db,
    env,
    log,
    storage,
    weather: env.WEATHER_PROVIDER === "open-meteo" ? new OpenMeteoProvider(env.WEATHER_API_URL) : new NoWeatherProvider(),
    push: env.PUSH_PROVIDER === "expo" ? new ExpoPushProvider(env.EXPO_ACCESS_TOKEN) : new LogPushProvider((m) => log.debug(m)),
    mailer: env.MAIL_PROVIDER === "resend" ? new ResendMailer(env.RESEND_API_KEY!, env.MAIL_FROM) : new ConsoleMailer((m) => log.info(m)),
    designs,
    events: env.REDIS_URL ? new RedisEventBus(env.REDIS_URL) : new InMemoryEventBus(),
    jobs: env.REDIS_URL ? new BullJobQueue(env.REDIS_URL) : inlineJobs!,
    oauth: new OAuthVerifier(
      (env.GOOGLE_OAUTH_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      (env.APPLE_OAUTH_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    ),
    ai: env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY ? new AnthropicAiProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL) : null,
    now: () => new Date(),
    ...overrides,
  };
  if (inlineJobs) {
    const handlers = jobHandlers(deps);
    for (const name of JOB_NAMES) inlineJobs.register(name, handlers[name]);
  }
  return {
    deps,
    async close() {
      await deps.jobs.close();
      await deps.events.close();
      await pool.end();
    },
  };
}
