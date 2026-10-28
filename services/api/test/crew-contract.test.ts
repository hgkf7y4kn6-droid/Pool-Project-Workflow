import { describe, expect, it } from "vitest";
import { CrewAiAgentProvider } from "../src/adapters/agents/crewai";
import { AgentProviderError, type AgentRequestBase } from "../src/adapters/agents/types";

/*
 * Contract test against the real services/crew app (with a scripted model):
 *   cd services/crew && python -m tests.serve_scripted 8765
 *   CREW_CONTRACT_URL=http://127.0.0.1:8765 npx vitest run test/crew-contract.test.ts
 * Skipped unless CREW_CONTRACT_URL is set.
 */
const url = process.env.CREW_CONTRACT_URL;
const TOKEN = "test-token-test-token-test-token";

const base: AgentRequestBase = {
  request_id: "11111111-1111-4111-8111-111111111111",
  depth: "full",
  project: { id: "8b0c1c0e-5b7e-4a39-9b65-111111111111", name: "Contract Pool", number: "P-2026-900", status: "construction", today: "2026-06-01" },
  records: [{ type: "project", id: "8b0c1c0e-5b7e-4a39-9b65-111111111111", label: "Contract Pool", facts: "status construction" }],
  findings: [
    { id: "rec-1", agent: "readiness", severity: "critical", title: "Permit", observation: "o", risk: "r", recommended_action: "a", responsible_role: "office", due_date: null, evidence_ids: [] },
  ],
  readiness: { label: "blocked", score: 40, next_milestone: { stage_name: "Excavation", label: "blocked", score: 40, planned_start: "2026-06-03", blockers: ["Permits"], risks: [], missing_data: [] } },
};

describe.skipIf(!url)("CrewAI service contract", () => {
  const provider = new CrewAiAgentProvider(url!, TOKEN, 30_000);

  it("briefing round-trips through the TypeScript schema", async () => {
    const res = await provider.briefing({ ...base, kind: "briefing" });
    expect(res.narrative).toMatch(/permit/);
    expect(res.model).toBe("scripted-model");
    expect(res.proposed_actions).toEqual([]);
  });

  it("ask returns citations the API can validate", async () => {
    const res = await provider.ask({ ...base, kind: "ask", question: "What next?" });
    expect(res.citations).toEqual([{ type: "project", id: base.project.id }]);
  });

  it("draft returns subject, body and claims", async () => {
    const res = await provider.draft({ ...base, kind: "draft", draft: { audience: "homeowner", kind: "weekly_update", guidance: null, facts: [{ id: "f1", type: "project", text: "Fact" }] } });
    expect(res.subject).toBe("Update");
    expect(res.claims).toEqual([]);
  });

  it("maps auth failures to a non-retryable provider error", async () => {
    const bad = new CrewAiAgentProvider(url!, "wrong-token-wrong-token-wrong", 5_000);
    await expect(bad.ask({ ...base, kind: "ask", question: "What next?" })).rejects.toBeInstanceOf(AgentProviderError);
  });
});
