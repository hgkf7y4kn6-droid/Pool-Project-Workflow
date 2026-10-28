import type { Database } from "@pool/database";
import type { Role } from "@pool/types";
import type { Logger } from "pino";
import type { Env } from "./config/env";
import type { AiProvider } from "./adapters/ai/types";
import type { AgentProvider } from "./adapters/agents/types";
import type { DesignProviderRegistry } from "./adapters/design/registry";
import type { JobQueue } from "./adapters/jobs";
import type { Mailer } from "./adapters/mail";
import type { OAuthVerifier } from "./adapters/oauth";
import type { PushProvider } from "./adapters/push";
import type { EventBus } from "./adapters/realtime";
import type { StorageProvider } from "./adapters/storage/types";
import type { WeatherProvider } from "./adapters/weather/types";

/** Infrastructure shared by every request (built once at boot). */
export interface Deps {
  db: Database;
  env: Env;
  log: Logger;
  storage: StorageProvider;
  weather: WeatherProvider;
  push: PushProvider;
  mailer: Mailer;
  designs: DesignProviderRegistry;
  events: EventBus;
  jobs: JobQueue;
  oauth: OAuthVerifier;
  ai: AiProvider | null;
  /** Project-intelligence agents (CrewAI service or single-call fallback); null = rules only. */
  agents: AgentProvider | null;
  now: () => Date;
}

/** The authenticated principal, derived from the verified access token. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: Role;
  clientId: string | null;
  sessionId: string;
}

/** What every service function receives. */
export interface Ctx {
  deps: Deps;
  auth: AuthContext;
  ip?: string;
  requestId?: string;
  /**
   * Projects changed during this request. Their intelligence is re-evaluated
   * after the response is sent — i.e. after the request's transactions have
   * committed. Without it (jobs, scripts) evaluations are queued immediately.
   */
  changedProjects?: Map<string, string>;
}
