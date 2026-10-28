import { z } from "zod";
import { AGENT_KEYS, COMMUNICATION_AUDIENCES, COMMUNICATION_KINDS, EVIDENCE_TYPES, SEVERITIES } from "@pool/types";

/*
 * Contract between the API and an agent provider (the CrewAI service, or the
 * single-call Anthropic fallback). The API sends only records the requesting
 * principal may read; the provider returns structured output that the API
 * validates again before anything is stored or shown. Providers have no
 * database access and no tools: they can't change anything.
 */

export const agentRecordSchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  id: z.string(),
  label: z.string(),
  facts: z.string(),
});
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const agentFindingSchema = z.object({
  id: z.string(),
  agent: z.enum(AGENT_KEYS),
  severity: z.enum(SEVERITIES),
  title: z.string(),
  observation: z.string(),
  risk: z.string(),
  recommended_action: z.string(),
  responsible_role: z.string(),
  due_date: z.string().nullable(),
  evidence_ids: z.array(z.string()),
});
export type AgentFinding = z.infer<typeof agentFindingSchema>;

export interface AgentRequestBase {
  request_id: string;
  depth: "compact" | "full";
  project: { id: string; name: string; number: string; status: string; today: string };
  records: AgentRecord[];
  findings: AgentFinding[];
  readiness: {
    label: string;
    score: number;
    next_milestone: { stage_name: string; label: string; score: number; planned_start: string | null; blockers: string[]; risks: string[]; missing_data: string[] } | null;
  };
}

export interface BriefingRequest extends AgentRequestBase {
  kind: "briefing";
}
export interface AskRequest extends AgentRequestBase {
  kind: "ask";
  question: string;
}
export interface DraftRequest extends AgentRequestBase {
  kind: "draft";
  draft: { audience: (typeof COMMUNICATION_AUDIENCES)[number]; kind: (typeof COMMUNICATION_KINDS)[number]; guidance: string | null; facts: { id: string; type: string; text: string }[] };
}
export type AgentRequest = BriefingRequest | AskRequest | DraftRequest;

const citation = z.object({ type: z.string(), id: z.string() });
const usage = z.object({ input_tokens: z.number().int().nonnegative().nullable().default(null), output_tokens: z.number().int().nonnegative().nullable().default(null) }).default({ input_tokens: null, output_tokens: null });

export const briefingResponseSchema = z.object({
  narrative: z.string().min(1).max(6000),
  priorities: z
    .array(z.object({ text: z.string().min(1).max(600), recommendation_id: z.string().nullable().default(null), citations: z.array(citation).max(20).default([]) }))
    .max(10)
    .default([]),
  citations: z.array(citation).max(60).default([]),
  proposed_actions: z.array(z.object({ type: z.string() }).passthrough()).max(10).default([]),
  model: z.string().nullable().default(null),
  usage,
});
export type BriefingResponse = z.infer<typeof briefingResponseSchema>;

export const askResponseSchema = z.object({
  answer: z.string().min(1).max(8000),
  citations: z.array(citation).max(60).default([]),
  proposed_actions: z.array(z.object({ type: z.string() }).passthrough()).max(10).default([]),
  model: z.string().nullable().default(null),
  usage,
});
export type AskResponse = z.infer<typeof askResponseSchema>;

export const draftResponseSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  claims: z.array(z.object({ text: z.string().max(1000), fact_ids: z.array(z.string()).max(20).default([]) })).max(60).default([]),
  model: z.string().nullable().default(null),
  usage,
});
export type DraftResponse = z.infer<typeof draftResponseSchema>;

export class AgentProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly kind: "timeout" | "unavailable" | "invalid_output" | "rejected" = "unavailable",
  ) {
    super(message);
    this.name = "AgentProviderError";
  }
}

export interface AgentProvider {
  readonly id: "crewai" | "anthropic";
  briefing(req: BriefingRequest): Promise<BriefingResponse>;
  ask(req: AskRequest): Promise<AskResponse>;
  draft(req: DraftRequest): Promise<DraftResponse>;
}
