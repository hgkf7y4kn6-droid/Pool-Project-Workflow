import type { z } from "zod";
import {
  AgentProviderError,
  askResponseSchema,
  briefingResponseSchema,
  draftResponseSchema,
  type AgentProvider,
  type AgentRequest,
  type AskRequest,
  type BriefingRequest,
  type DraftRequest,
} from "./types";

/**
 * Client for services/crew (the CrewAI service). Authenticated with a shared
 * bearer token; one bounded retry for transient failures (network, 502–504).
 * Output is schema-validated here and again by the intelligence service.
 */
export class CrewAiAgentProvider implements AgentProvider {
  readonly id = "crewai" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  briefing(req: BriefingRequest) {
    return this.call("/v1/briefing", req, briefingResponseSchema);
  }
  ask(req: AskRequest) {
    return this.call("/v1/ask", req, askResponseSchema);
  }
  draft(req: DraftRequest) {
    return this.call("/v1/draft", req, draftResponseSchema);
  }

  private async call<S extends z.ZodTypeAny>(path: string, body: AgentRequest, schema: S): Promise<z.infer<S>> {
    let lastError: AgentProviderError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt) await new Promise((r) => setTimeout(r, 1_000));
      try {
        const res = await this.fetchImpl(new URL(path, this.baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, "x-request-id": body.request_id },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          lastError = new AgentProviderError(`Agent service unavailable (${res.status})`, true);
          continue;
        }
        if (res.status === 422) throw new AgentProviderError("The agent service rejected the request", false, "rejected");
        if (!res.ok) throw new AgentProviderError(`Agent service error (${res.status})`, false);
        const parsed = schema.safeParse(await res.json());
        if (!parsed.success) throw new AgentProviderError("The agent returned output that doesn't match the contract", false, "invalid_output");
        return parsed.data;
      } catch (err) {
        if (err instanceof AgentProviderError) {
          if (!err.retryable) throw err;
          lastError = err;
          continue;
        }
        const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        lastError = new AgentProviderError(timeout ? "The agent service timed out" : "The agent service is unreachable", !timeout, timeout ? "timeout" : "unavailable");
        if (timeout) break;
      }
    }
    throw lastError ?? new AgentProviderError("The agent service failed", false);
  }
}
