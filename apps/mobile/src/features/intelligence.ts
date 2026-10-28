import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Href } from "expo-router";
import type {
  AgentRun,
  CommunicationDraft,
  EvidenceType,
  IntelligenceAnswer,
  IntelligenceSettings,
  PortfolioOverview,
  ProjectIntelligence,
  Recommendation,
  RecommendationEvent,
} from "@pool/types";
import { api } from "@/lib/api";
import { useApi } from "./data";

/*
 * Project intelligence is online data (React Query): it's computed on the
 * server from every record, not just what this device has synced.
 */

export const INTEL_KEY = "intelligence";

export function useProjectIntelligence(projectId: string | undefined, enabled = true) {
  return useApi<ProjectIntelligence>([INTEL_KEY, "project", projectId], enabled && projectId ? `/projects/${projectId}/intelligence` : null);
}

export function useRecommendations(query: { projectId?: string; status?: string; severity?: string; assigneeId?: string; limit?: number }, enabled = true) {
  return useApi<Recommendation[]>([INTEL_KEY, "recommendations"], enabled ? "/recommendations" : null, query);
}

export function useRecommendation(id: string | undefined) {
  return useApi<Recommendation & { history: RecommendationEvent[] }>([INTEL_KEY, "recommendation", id], id ? `/recommendations/${id}` : null);
}

export function useDrafts(projectId: string | undefined) {
  return useApi<CommunicationDraft[]>([INTEL_KEY, "drafts", projectId], projectId ? `/projects/${projectId}/communications` : null);
}

export function useDraft(id: string | undefined) {
  return useApi<CommunicationDraft>([INTEL_KEY, "draft", id], id ? `/communications/${id}` : null);
}

export function usePortfolio(enabled = true) {
  return useApi<PortfolioOverview>([INTEL_KEY, "portfolio"], enabled ? "/intelligence/portfolio" : null);
}

export function useIntelligenceSettings() {
  return useApi<{ settings: IntelligenceSettings; agentProvider: string; canConfigure: boolean }>([INTEL_KEY, "settings"], "/intelligence/settings");
}

export function useAgentRuns(enabled: boolean) {
  return useApi<{ items: AgentRun[]; usage30d: { runs: number; inputTokens: number; outputTokens: number; failed: number } }>([INTEL_KEY, "runs"], enabled ? "/intelligence/runs" : null, { limit: 30 });
}

/** Mutation that refreshes every intelligence view afterwards. */
export function useIntelMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: [INTEL_KEY] }),
  });
}

export const askIntelligence = (projectId: string, question: string) => api.post<IntelligenceAnswer>(`/projects/${projectId}/intelligence/ask`, { question });

/** Where a cited record lives in the app (null when it has no screen of its own). */
export function recordHref(type: EvidenceType, id: string, projectId: string): Href | null {
  switch (type) {
    case "task":
      return `/tasks/${id}`;
    case "inspection":
      return `/inspections/${id}`;
    case "change_order":
      return `/change-orders/${id}`;
    case "document":
      return `/documents/${id}`;
    case "approval":
      return { pathname: "/approvals", params: { projectId } };
    case "stage":
    case "dependency":
      return `/projects/${projectId}/schedule`;
    case "material":
      return `/projects/${projectId}/materials`;
    case "project":
      return `/projects/${projectId}`;
    case "message":
      return `/projects/${projectId}/messages`;
    case "activity":
      return `/projects/${projectId}/activity`;
    default:
      return null;
  }
}

export const ROLE_OWNER_LABELS: Record<string, string> = {
  admin: "Admin",
  project_manager: "Project manager",
  field_supervisor: "Field supervisor",
  designer: "Designer",
  office: "Office",
};
