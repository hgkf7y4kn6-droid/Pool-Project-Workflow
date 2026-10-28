import type { Citation, CommunicationFact, EvidenceType, ProposedAction, ReadinessLabel } from "@pool/types";
import { PROPOSED_ACTION_TYPES } from "@pool/types";

/*
 * Guards applied to every LLM/agent output before it is stored or shown.
 * Agent text is untrusted: citations must point at records that were in the
 * data sent to the agent, proposed actions must be allowlisted, and claims
 * that contradict the deterministic assessment are rejected.
 */

export interface KnownRecords {
  has(type: EvidenceType, id: string): boolean;
  label(type: EvidenceType, id: string): string | null;
}

export function knownRecords(records: { type: EvidenceType; id: string; label: string }[]): KnownRecords {
  const map = new Map(records.map((r) => [`${r.type}:${r.id}`, r.label]));
  return {
    has: (type, id) => map.has(`${type}:${id}`),
    label: (type, id) => map.get(`${type}:${id}`) ?? null,
  };
}

/** Keep citations that reference known records; report the rest. */
export function filterCitations(citations: { type: string; id: string; label?: string }[], known: KnownRecords): { valid: Citation[]; dropped: number } {
  const valid: Citation[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const c of citations) {
    const type = c.type as EvidenceType;
    const label = known.label(type, c.id);
    if (label === null) {
      dropped += 1;
      continue;
    }
    const key = `${type}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ type, id: c.id, label });
  }
  return { valid, dropped };
}

/** Only allowlisted action types survive; anything else is reported as a violation. */
export function filterProposedActions(actions: { type: string }[]): { allowed: ProposedAction[]; rejected: string[] } {
  const allowed: ProposedAction[] = [];
  const rejected: string[] = [];
  for (const a of actions) {
    if ((PROPOSED_ACTION_TYPES as readonly string[]).includes(a.type)) allowed.push(a as ProposedAction);
    else rejected.push(a.type);
  }
  return { allowed, rejected };
}

const READY_CLAIM = /\b(is|are|we're|we are)\s+(fully\s+)?(ready|cleared|good to go)\b/i;

/**
 * Reject narratives that call a blocked milestone ready. The deterministic
 * readiness label is authoritative; an agent may explain it, not overrule it.
 */
export function contradictsReadiness(text: string, label: ReadinessLabel | null, stageName: string | null): boolean {
  if (label !== "blocked" || !stageName) return false;
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.some((s) => s.toLowerCase().includes(stageName.toLowerCase()) && READY_CLAIM.test(s) && !/\bnot\b|\bisn't\b|\baren't\b/i.test(s));
}

/**
 * Communication drafts: every claim the agent made must cite at least one
 * provided fact. Claims without support are returned for the reviewer, and
 * numbers/dates in the body that appear in no fact are flagged too.
 */
export function unsupportedClaims(body: string, claims: { text: string; factIds: string[] }[], facts: CommunicationFact[]): string[] {
  const ids = new Set(facts.map((f) => f.id));
  const issues = claims.filter((c) => !c.factIds.length || c.factIds.some((id) => !ids.has(id))).map((c) => c.text);
  const factText = facts.map((f) => f.text).join(" ");
  for (const token of body.match(/\b\d{4}-\d{2}-\d{2}\b|\$\s?\d[\d,]*(\.\d+)?/g) ?? []) {
    const plain = token.replace(/\s/g, "");
    if (!factText.replace(/\s/g, "").includes(plain)) issues.push(`"${token}" doesn't appear in the project records`);
  }
  return [...new Set(issues)];
}

/** Strip characters and markup that could smuggle instructions out of the data block. */
export function sanitizeForPrompt(text: string, max = 500): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/<\/?\s*(project_data|system|instructions?)[^>]*>/gi, "")
    .slice(0, max);
}
